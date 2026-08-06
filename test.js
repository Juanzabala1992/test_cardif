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
cat > extract_limits_excel.sh <<'EOF'
#!/usr/bin/env bash

set -o pipefail

# Primer argumento: patrón de namespaces.
PATTERN="${1:-c-prd-|c-prod-}"

# Segundo argumento: nombre del CSV.
OUTPUT_FILE="${2:-limites_deployments_$(date +%Y%m%d_%H%M%S).csv}"

TEMP_FILE="${OUTPUT_FILE}.tmp"


# ============================================================
# Escapar valores de texto para CSV
# ============================================================

csv_escape() {
    local value="$1"

    value="${value//\"/\"\"}"

    printf '%s' "$value"
}


# ============================================================
# Validar comandos requeridos
# ============================================================

for cmd in oc jq awk grep; do

    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "ERROR: No se encontró el comando requerido: $cmd" >&2
        exit 1
    fi

done


# ============================================================
# Validar conexión con OpenShift
# ============================================================

if ! oc whoami >/dev/null 2>&1; then
    echo "ERROR: No hay una sesión activa en OpenShift." >&2
    echo "Ejecuta primero oc login." >&2
    exit 1
fi


# ============================================================
# Preparar archivo temporal
# ============================================================

rm -f "$TEMP_FILE"

trap 'rm -f "$TEMP_FILE"' EXIT


# BOM UTF-8 para que Excel muestre correctamente los caracteres.
printf '\xEF\xBB\xBF' > "$TEMP_FILE"

# Encabezados.
# Se usa ; porque Excel en español normalmente utiliza coma decimal.
printf 'Namespace;Servicio;CPU;Memoria\r\n' >> "$TEMP_FILE"


rows=0
namespaces=0


echo "============================================================"
echo "Generando archivo CSV"
echo "Patrón: $PATTERN"
echo "Archivo: $OUTPUT_FILE"
echo "============================================================"


# ============================================================
# Recorrer namespaces
# ============================================================

while IFS= read -r ns; do

    [[ -z "$ns" ]] && continue

    namespaces=$((namespaces + 1))

    echo "Procesando: $ns"


    deployment_json="$(
        oc get deployments \
            -n "$ns" \
            -o json \
            2>/dev/null
    )" || continue


    # ========================================================
    # Recorrer deployments
    # ========================================================

    while IFS= read -r deployment; do

        [[ -z "$deployment" ]] && continue


        service="$(
            jq -r '.metadata.name' <<< "$deployment"
        )"


        # Obtener los limits de todos los contenedores.
        limits="$(
            jq -r '
                (.spec.template.spec.containers // [])[]
                |
                [
                    (.resources.limits.cpu // ""),
                    (.resources.limits.memory // "")
                ]
                |
                @tsv
            ' <<< "$deployment"
        )"


        # ====================================================
        # Convertir CPU a cores y memoria a GiB
        # ====================================================

        result="$(
            printf '%s\n' "$limits" |
            awk -F '\t' '

                function cpu_to_cores(value, number) {

                    number = value

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


                function memory_to_gib(value, number) {

                    number = value

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

                    if (number ~ /[kK]$/) {
                        sub(/[kK]$/, "", number)
                        return (number * 1000) / 1073741824
                    }

                    if (number ~ /M$/) {
                        sub(/M$/, "", number)
                        return (number * 1000000) / 1073741824
                    }

                    if (number ~ /G$/) {
                        sub(/G$/, "", number)
                        return (number * 1000000000) / 1073741824
                    }

                    if (number ~ /T$/) {
                        sub(/T$/, "", number)
                        return (number * 1000000000000) / 1073741824
                    }

                    # Sin unidad, Kubernetes lo interpreta como bytes.
                    return number / 1073741824
                }


                {
                    if ($1 != "") {
                        cpu_sum += cpu_to_cores($1)
                        has_cpu = 1
                    }

                    if ($2 != "") {
                        memory_sum += memory_to_gib($2)
                        has_memory = 1
                    }
                }


                END {
                    cpu_text = has_cpu ? sprintf("%.3f", cpu_sum) : ""
                    memory_text = has_memory ? sprintf("%.3f", memory_sum) : ""

                    printf "%s|%s", cpu_text, memory_text
                }
            '
        )"


        IFS='|' read -r cpu memory <<< "$result"


        # Cambiar punto decimal por coma para Excel en español.
        cpu="${cpu/./,}"
        memory="${memory/./,}"


        ns_csv="$(csv_escape "$ns")"
        service_csv="$(csv_escape "$service")"


        # Escribir la fila.
        printf '"%s";"%s";%s;%s\r\n' \
            "$ns_csv" \
            "$service_csv" \
            "$cpu" \
            "$memory" \
            >> "$TEMP_FILE"


        rows=$((rows + 1))


    done < <(
        jq -c '.items[]' <<< "$deployment_json"
    )


done < <(
    oc get namespaces \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' \
        2>/dev/null |
    grep -E "$PATTERN" || true
)


# ============================================================
# Validar que se encontraron namespaces
# ============================================================

if (( namespaces == 0 )); then

    echo "No se encontraron namespaces con el patrón: $PATTERN" >&2

    exit 1

fi


# ============================================================
# Finalizar archivo
# ============================================================

mv "$TEMP_FILE" "$OUTPUT_FILE"

trap - EXIT


echo
echo "============================================================"
echo "Archivo creado correctamente: $OUTPUT_FILE"
echo "Filas generadas: $rows"
echo "============================================================"
echo
echo "Columnas:"
echo "  Namespace"
echo "  Servicio"
echo "  CPU"
echo "  Memoria"
echo
echo "CPU: límite por pod expresado en cores."
echo "Memoria: límite por pod expresado en GiB."
EOF
