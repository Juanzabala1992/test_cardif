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


  cat > extract_limits.sh <<'EOF'
#!/usr/bin/env bash

set -u

# Patrón predeterminado de namespaces.
PATTERN="${1:-c-prd-|c-prod-}"

# ============================================================
# Validaciones
# ============================================================

for cmd in oc jq awk grep; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "ERROR: No se encontró el comando requerido: $cmd" >&2
        exit 1
    fi
done

if ! oc whoami >/dev/null 2>&1; then
    echo "ERROR: No existe una sesión activa en OpenShift." >&2
    echo "Ejecuta primero oc login." >&2
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
echo "LIMITS configurados por Deployment"
echo "CPU expresada en cores y memoria expresada en GiB"
echo "Patrón utilizado: $PATTERN"
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
    )" || continue

    deployment_count="$(jq '.items | length' <<< "$deployment_json")"

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

        replicas="$(
            jq -r '.spec.replicas // 1' <<< "$deployment"
        )"

        # Obtiene limits de todos los contenedores del Deployment.
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
        # Convertir y sumar límites
        # ====================================================

        result="$(
            printf '%s\n' "$limits" |
            awk -v replicas="$replicas" '
                BEGIN {
                    FS = "\t"
                }

                function cpu_to_cores(value) {
                    if (value ~ /n$/) {
                        sub(/n$/, "", value)
                        return value / 1000000000
                    }

                    if (value ~ /u$/) {
                        sub(/u$/, "", value)
                        return value / 1000000
                    }

                    if (value ~ /m$/) {
                        sub(/m$/, "", value)
                        return value / 1000
                    }

                    return value + 0
                }

                function memory_to_gib(value) {
                    if (value ~ /Ki$/) {
                        sub(/Ki$/, "", value)
                        return value / 1048576
                    }

                    if (value ~ /Mi$/) {
                        sub(/Mi$/, "", value)
                        return value / 1024
                    }

                    if (value ~ /Gi$/) {
                        sub(/Gi$/, "", value)
                        return value + 0
                    }

                    if (value ~ /Ti$/) {
                        sub(/Ti$/, "", value)
                        return value * 1024
                    }

                    if (value ~ /Pi$/) {
                        sub(/Pi$/, "", value)
                        return value * 1048576
                    }

                    if (value ~ /[kK]$/) {
                        sub(/[kK]$/, "", value)
                        return (value * 1000) / 1073741824
                    }

                    if (value ~ /M$/) {
                        sub(/M$/, "", value)
                        return (value * 1000000) / 1073741824
                    }

                    if (value ~ /G$/) {
                        sub(/G$/, "", value)
                        return (value * 1000000000) / 1073741824
                    }

                    if (value ~ /T$/) {
                        sub(/T$/, "", value)
                        return (value * 1000000000000) / 1073741824
                    }

                    return value / 1073741824
                }

                {
                    if ($1 != "-" && $1 != "") {
                        cpu_sum += cpu_to_cores($1)
                        has_cpu = 1
                    }

                    if ($2 != "-" && $2 != "") {
                        memory_sum += memory_to_gib($2)
                        has_memory = 1
                    }
                }

                END {
                    cpu_pod = has_cpu ? sprintf("%.3f", cpu_sum) : "-"
                    memory_pod = has_memory ? sprintf("%.3f", memory_sum) : "-"
                    cpu_total = has_cpu ? sprintf("%.3f", cpu_sum * replicas) : "-"
                    memory_total = has_memory ? sprintf("%.3f", memory_sum * replicas) : "-"

                    printf "%s %s %s %s\n", cpu_pod, memory_pod, cpu_total, memory_total
                }
            '
        )"

        read -r \
            cpu_per_pod \
            memory_per_pod \
            cpu_total \
            memory_total \
            <<< "$result"

        printf '%-46s %5s %11s %11s %12s %12s\n' \
            "$deployment_name" \
            "$replicas" \
            "$cpu_per_pod" \
            "$memory_per_pod" \
            "$cpu_total" \
            "$memory_total"

    done < <(
        jq -c '.items[]' <<< "$deployment_json"
    )

done

echo
echo "Consulta finalizada."
EOF
