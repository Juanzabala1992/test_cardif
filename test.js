const { execSync } = require("child_process");

function run(cmd, name) {
  try {
    const out = execSync(cmd, { encoding: "utf8" }).trim();
    console.log(`[OK] ${name}: ${out}`);
    return true;
  } catch (e) {
    const stdout = e.stdout ? e.stdout.toString() : "";
    const stderr = e.stderr ? e.stderr.toString() : "";
    console.error(`[FAIL] ${name}: Command failed: ${cmd}`);
    if (stdout) console.error(stdout.trim());
    if (stderr) console.error(stderr.trim());
    return false;
  }
}

function exists(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

console.log("=== Smoke test Node + Chrome/Edge ===");
console.log(`[INFO] Node: ${process.version}`);

const chromeEnv = process.env.CHROME_BIN;
const edgeEnv = process.env.EDGE_BIN;

// defaults “oficiales”
const chromeDefault = "google-chrome-stable";
const edgeDefault = "microsoft-edge-stable";

// decide qué probar, basado en lo que realmente existe en la imagen
let testedAny = false;

// Chrome (solo si existe el binario)
const chromeCandidate = chromeEnv || chromeDefault;
console.log(`[INFO] CHROME_BIN: ${chromeEnv || "(not set)"} (candidate: ${chromeCandidate})`);
if (exists(chromeCandidate)) {
  testedAny = true;
  const ok = run(`${chromeCandidate} --version`, "Google Chrome");
  if (!ok) process.exit(1);
} else {
  console.log(`[SKIP] Google Chrome: ${chromeCandidate} not found in image`);
}

// Edge (solo si existe el binario)
const edgeCandidate = edgeEnv || edgeDefault;
console.log(`[INFO] EDGE_BIN: ${edgeEnv || "(not set)"} (candidate: ${edgeCandidate})`);
if (exists(edgeCandidate)) {
  testedAny = true;
  const ok = run(`${edgeCandidate} --version`, "Microsoft Edge");
  if (!ok) process.exit(1);
} else {
  console.log(`[SKIP] Microsoft Edge: ${edgeCandidate} not found in image`);
}

if (!testedAny) {
  console.error("[FAIL] No browsers found (neither Chrome nor Edge).");
  process.exit(1);
}

console.log("✅ Todo OK");

**********************************************************************************************
  *************************************************************************************
#!/usr/bin/env bash

set -uo pipefail

# Patrón predeterminado para buscar namespaces.
# Puedes cambiarlo aquí o enviarlo como primer argumento.
PATTERN="${1:-c-prd-|c-prod-}"


# ============================================================
# Validaciones
# ============================================================

for command in oc jq awk grep; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "ERROR: No se encontró el comando requerido: $command"
        exit 1
    fi
done


if ! oc whoami >/dev/null 2>&1; then
    echo "ERROR: No existe una sesión activa en OpenShift."
    echo "Ejecuta primero el comando oc login."
    exit 1
fi


# ============================================================
# Obtener namespaces
# ============================================================

mapfile -t namespaces < <(
    oc get namespaces \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' \
        2>/dev/null |
    grep -E "$PATTERN" || true
)


if (( ${#namespaces[@]} == 0 )); then
    echo "No se encontraron namespaces con el patrón: $PATTERN"
    exit 0
fi


echo "================================================================================================================"
echo "Buscando límites configurados en namespaces con patrón: $PATTERN"
echo "CPU expresada en cores y memoria expresada en GiB"
echo "================================================================================================================"


# ============================================================
# Recorrer namespaces
# ============================================================

for ns in "${namespaces[@]}"; do

    deployment_json="$(
        oc get deployments \
            -n "$ns" \
            -o json \
            2>/dev/null
    )"

    if [[ $? -ne 0 || -z "$deployment_json" ]]; then
        echo
        echo "No fue posible consultar deployments en: $ns"
        continue
    fi


    deployment_count="$(
        jq '.items | length' <<< "$deployment_json"
    )"


    if [[ "$deployment_count" -eq 0 ]]; then
        continue
    fi


    echo
    echo "NAMESPACE: $ns"

    printf '%-46s %5s %11s %11s %12s %12s\n' \
        "NAME" \
        "REP" \
        "CPU/POD" \
        "MEM/POD" \
        "CPU TOTAL" \
        "MEM TOTAL"

    printf '%-46s %5s %11s %11s %12s %12s\n' \
        "----------------------------------------------" \
        "-----" \
        "-----------" \
        "-----------" \
        "------------" \
        "------------"


    # ========================================================
    # Recorrer deployments
    # ========================================================

    while IFS= read -r deployment; do

        deployment_name="$(
            jq -r '.metadata.name' <<< "$deployment"
        )"


        # Réplicas deseadas configuradas en el deployment.
        replicas="$(
            jq -r '.spec.replicas // 1' <<< "$deployment"
        )"


        # Obtener los limits de todos los contenedores normales
        # definidos dentro del template del deployment.
        limits="$(
            jq -r '
                (.spec.template.spec.containers // [])[]
                |
                [
                    (.resources.limits.cpu // "-"),
                    (.resources.limits.memory // "-")
                ]
                |
                @tsv
            ' <<< "$deployment"
        )"


        # Si no se encontraron contenedores.
        if [[ -z "$limits" ]]; then

            printf '%-46s %5s %11s %11s %12s %12s\n' \
                "$deployment_name" \
                "$replicas" \
                "-" \
                "-" \
                "-" \
                "-"

            continue
        fi


        # ====================================================
        # Convertir y sumar los límites
        #
        # CPU:
        #   10m = 0.010 cores
        #   500m = 0.500 cores
        #   1 = 1.000 cores
        #
        # Memoria:
        #   10Mi = 0.010 GiB
        #   512Mi = 0.500 GiB
        #   1Gi = 1.000 GiB
        # ====================================================

        read -r \
            cpu_per_pod \
            mem_per_pod \
            cpu_total \
            mem_total \
        < <(
            printf '%s\n' "$limits" |
            awk \
                -v replicas="$replicas" \
                '
                BEGIN {
                    FS = "\t"
                }


                # --------------------------------------------
                # Convertir CPU a cores
                # --------------------------------------------

                function cpu_to_cores(quantity, number) {

                    number = quantity

                    if (number ~ /n$/) {
                        sub(/n$/, "", number)
                        return number / 1000000000
                    }

                    if (number ~ /u$/) {
                        sub(/u$/, "", number)
                        return number / 1000000
                    }

                    if (number ~ /m$/) {
                        sub(/m$/, "", number)
                        return number / 1000
                    }

                    return number + 0
                }


                # --------------------------------------------
                # Convertir memoria a GiB
                # --------------------------------------------

                function memory_to_gib(quantity, number) {

                    number = quantity

                    # Unidades binarias

                    if (number ~ /Ki$/) {
                        sub(/Ki$/, "", number)
                        return number / 1048576
                    }

                    if (number ~ /Mi$/) {
                        sub(/Mi$/, "", number)
                        return number / 1024
                    }

                    if (number ~ /Gi$/) {
                        sub(/Gi$/, "", number)
                        return number + 0
                    }

                    if (number ~ /Ti$/) {
                        sub(/Ti$/, "", number)
                        return number * 1024
                    }

                    if (number ~ /Pi$/) {
                        sub(/Pi$/, "", number)
                        return number * 1048576
                    }


                    # Unidades decimales

                    if (number ~ /[kK]$/) {
                        sub(/[kK]$/, "", number)
                        return \
                            (number * 1000) / 1073741824
                    }

                    if (number ~ /M$/) {
                        sub(/M$/, "", number)
                        return \
                            (number * 1000000) / 1073741824
                    }

                    if (number ~ /G$/) {
                        sub(/G$/, "", number)
                        return \
                            (number * 1000000000) / 1073741824
                    }

                    if (number ~ /T$/) {
                        sub(/T$/, "", number)
                        return \
                            (number * 1000000000000) / 1073741824
                    }


                    # Un valor sin sufijo representa bytes.

                    return number / 1073741824
                }


                {
                    cpu_quantity = $1
                    memory_quantity = $2


                    if (
                        cpu_quantity != "-" &&
                        cpu_quantity != ""
                    ) {
                        cpu_sum += \
                            cpu_to_cores(cpu_quantity)

                        has_cpu = 1
                    }


                    if (
                        memory_quantity != "-" &&
                        memory_quantity != ""
                    ) {
                        memory_sum += \
                            memory_to_gib(memory_quantity)

                        has_memory = 1
                    }
                }


                END {

                    if (has_cpu) {
                        cpu_pod_text = \
                            sprintf("%.3f", cpu_sum)

                        cpu_total_text = \
                            sprintf(
                                "%.3f",
                                cpu_sum * replicas
                            )
                    } else {
                        cpu_pod_text = "-"
                        cpu_total_text = "-"
                    }


                    if (has_memory) {
                        memory_pod_text = \
                            sprintf("%.3f", memory_sum)

                        memory_total_text = \
                            sprintf(
                                "%.3f",
                                memory_sum * replicas
                            )
                    } else {
                        memory_pod_text = "-"
                        memory_total_text = "-"
                    }


                    print \
                        cpu_pod_text, \
                        memory_pod_text, \
                        cpu_total_text, \
                        memory_total_text
                }
                '
        )


        printf '%-46s %5s %11s %11s %12s %12s\n' \
            "$deployment_name" \
            "$replicas" \
            "$cpu_per_pod" \
            "$mem_per_pod" \
            "$cpu_total" \
            "$mem_total"


    done < <(
        jq -c '.items[]' <<< "$deployment_json"
    )

done


echo
echo "Consulta finalizada."

