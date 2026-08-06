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

# ============================================================
# Validaciones
# ============================================================

for cmd in oc jq grep; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "ERROR: No se encontró el comando: $cmd" >&2
        exit 1
    fi
done

if ! oc whoami >/dev/null 2>&1; then
    echo "ERROR: No existe una sesión activa en OpenShift." >&2
    echo "Ejecuta primero oc login." >&2
    exit 1
fi

# ============================================================
# Crear archivo compatible con Excel
# ============================================================

# BOM UTF-8 y configuración del separador.
printf '\xEF\xBB\xBFsep=;\r\n' > "$OUTPUT_FILE"

# Encabezados.
printf 'Namespace;Servicio;CPU;Memoria\r\n' >> "$OUTPUT_FILE"

rows=0

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

    echo "Procesando namespace: $ns"

    deployment_json="$(
        oc get deployments \
            -n "$ns" \
            -o json \
            2>/dev/null
    )" || continue

    # ========================================================
    # Obtener servicio, CPU limit y memoria limit
    # ========================================================

    while IFS='|' read -r servicio cpu memoria; do

        [[ -z "$servicio" ]] && continue

        # Convertir punto decimal en coma para Excel en español.
        cpu="${cpu/./,}"
        memoria="${memoria/./,}"

        printf '"%s";"%s";%s;%s\r\n' \
            "$ns" \
            "$servicio" \
            "$cpu" \
            "$memoria" \
            >> "$OUTPUT_FILE"

        rows=$((rows + 1))

    done < <(
        jq -r '
            # ================================================
            # Convertir CPU de Kubernetes a cores
            # ================================================

            def cpu_to_cores:
                tostring as $q
                |
                if ($q | test("n$")) then
                    (($q | sub("n$"; "") | tonumber) / 1000000000)

                elif ($q | test("u$")) then
                    (($q | sub("u$"; "") | tonumber) / 1000000)

                elif ($q | test("m$")) then
                    (($q | sub("m$"; "") | tonumber) / 1000)

                else
                    ($q | tonumber)
                end;

            # ================================================
            # Convertir memoria de Kubernetes a GiB
            # ================================================

            def memory_to_gib:
                tostring as $q
                |
                if ($q | test("Ki$")) then
                    (($q | sub("Ki$"; "") | tonumber) / 1048576)

                elif ($q | test("Mi$")) then
                    (($q | sub("Mi$"; "") | tonumber) / 1024)

                elif ($q | test("Gi$")) then
                    ($q | sub("Gi$"; "") | tonumber)

                elif ($q | test("Ti$")) then
                    (($q | sub("Ti$"; "") | tonumber) * 1024)

                elif ($q | test("K$")) then
                    (
                        (($q | sub("K$"; "") | tonumber) * 1000)
                        / 1073741824
                    )

                elif ($q | test("M$")) then
                    (
                        (($q | sub("M$"; "") | tonumber) * 1000000)
                        / 1073741824
                    )

                elif ($q | test("G$")) then
                    (
                        (($q | sub("G$"; "") | tonumber) * 1000000000)
                        / 1073741824
                    )

                elif ($q | test("T$")) then
                    (
                        (($q | sub("T$"; "") | tonumber) * 1000000000000)
                        / 1073741824
                    )

                else
                    (($q | tonumber) / 1073741824)
                end;

            # Redondear a máximo tres decimales.
            def round3:
                (((. * 1000) | round) / 1000 | tostring);

            .items[]
            |
            .metadata.name as $service

            # Obtener y sumar CPU limits de todos los contenedores.
            |
            [
                (.spec.template.spec.containers // [])[]
                |
                (.resources.limits.cpu? // empty)
                |
                cpu_to_cores
            ] as $cpus

            # Obtener y sumar memoria limits de todos los contenedores.
            |
            [
                (.spec.template.spec.containers // [])[]
                |
                (.resources.limits.memory? // empty)
                |
                memory_to_gib
            ] as $memories

            |
            [
                $service,

                (
                    if ($cpus | length) > 0 then
                        ($cpus | add | round3)
                    else
                        ""
                    end
                ),

                (
                    if ($memories | length) > 0 then
                        ($memories | add | round3)
                    else
                        ""
                    end
                )
            ]

            |
            join("|")
        ' <<< "$deployment_json"
    )

done < <(
    oc get namespaces \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' \
        2>/dev/null |
    grep -E "$PATTERN" || true
)

echo
echo "============================================================"
echo "Archivo creado: $OUTPUT_FILE"
echo "Filas generadas: $rows"
echo "============================================================"
EOF
