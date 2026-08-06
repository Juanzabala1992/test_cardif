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
cat > extract_limits_csv.sh <<'EOF'
#!/usr/bin/env bash

set -u

# Primer parámetro: patrón de namespaces.
PATTERN="${1:-c-prd-|c-prod-}"

# Segundo parámetro: nombre del archivo CSV.
OUTPUT_FILE="${2:-limits_deployments_$(date +%Y%m%d_%H%M%S).csv}"

# ============================================================
# Funciones
# ============================================================

csv_escape() {
    local value="$1"
    value="${value//\"/\"\"}"
    printf '%s' "$value"
}

excel_decimal() {
    local value="$1"

    if [[ -z "$value" || "$value" == "-" ]]; then
        printf ''
    else
        # Convierte 0.010 en 0,010 para Excel en español.
        printf '%s' "${value/./,}"
    fi
}

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

# ============================================================
# Crear el CSV
# ============================================================

# BOM UTF-8 para que Excel reconozca correctamente el archivo.
printf '\xEF\xBB\xBF' > "$OUTPUT_FILE"

# Indica a Excel que el separador es punto y coma.
printf 'sep=;\r\n' >> "$OUTPUT_FILE"

printf '%s\r\n' \
'NAMESPACE;DEPLOYMENT;REPLICAS;CPU_LIMIT_POD_CORES;MEM_LIMIT_POD_GIB;CPU_LIMIT_TOTAL_CORES;MEM_LIMIT_TOTAL_GIB' \
>> "$OUTPUT_FILE"

echo "============================================================"
echo "Generando archivo CSV"
echo "Patrón: $PATTERN"
echo "Archivo: $OUTPUT_FILE"
echo "============================================================"

rows_written=0

# ============================================================
# Recorrer namespaces
# ============================================================

for ns in "${namespaces[@]}"; do

    echo "Procesando namespace: $ns"

    deployment_json="$(
        oc get deployments \
            -n "$ns" \
            -o json \
            2>/dev/null
    )" || continue

    deployment_count="$(
        jq '.items | length' <<< "$deployment_json"
    )"

    if [[ "$deployment_count" -eq 0 ]]; then
        continue
    fi

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

        # Obtener limits de todos los contenedores.
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
            cpu_per_pod=""
            memory_per_pod=""
            cpu_total=""
            memory_total=""
        else

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

                        # Sin sufijo se interpreta como bytes.
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
                        if (has_cpu) {
                            cpu_pod = sprintf("%.3f", cpu_sum)
                            cpu_total = sprintf(
                                "%.3f",
                                cpu_sum * replicas
                            )
                        } else {
                            cpu_pod = ""
                            cpu_total = ""
                        }

                        if (has_memory) {
                            memory_pod = sprintf("%.3f", memory_sum)
                            memory_total = sprintf(
                                "%.3f",
                                memory_sum * replicas
                            )
                        } else {
                            memory_pod = ""
                            memory_total = ""
                        }

                        printf "%s|%s|%s|%s\n",
                            cpu_pod,
                            memory_pod,
                            cpu_total,
                            memory_total
                    }
                '
            )"

            IFS='|' read -r \
                cpu_per_pod \
                memory_per_pod \
                cpu_total \
                memory_total \
                <<< "$result"
        fi

        cpu_per_pod_excel="$(excel_decimal "$cpu_per_pod")"
        memory_per_pod_excel="$(excel_decimal "$memory_per_pod")"
        cpu_total_excel="$(excel_decimal "$cpu_total")"
        memory_total_excel="$(excel_decimal "$memory_total")"

        ns_csv="$(csv_escape "$ns")"
        deployment_csv="$(csv_escape "$deployment_name")"

        printf '"%s";"%s";%s;%s;%s;%s;%s\r\n' \
            "$ns_csv" \
            "$deployment_csv" \
            "$replicas" \
            "$cpu_per_pod_excel" \
            "$memory_per_pod_excel" \
            "$cpu_total_excel" \
            "$memory_total_excel" \
            >> "$OUTPUT_FILE"

        rows_written=$((rows_written + 1))

    done < <(
        jq -c '.items[]' <<< "$deployment_json"
    )

done

echo
echo "============================================================"
echo "Proceso finalizado"
echo "Registros generados: $rows_written"
echo "Archivo creado: $OUTPUT_FILE"
echo "============================================================"
EOF
