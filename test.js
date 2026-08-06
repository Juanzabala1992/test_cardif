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


  cat > extract_services.sh <<'EOF'
#!/usr/bin/env bash

# Patrón predeterminado para los namespaces.
# También puedes enviarlo como primer argumento.
PATTERN="${1:-c-prd-|c-prod-}"

# ============================================================
# Validaciones
# ============================================================

if ! command -v oc >/dev/null 2>&1; then
    echo "ERROR: No se encontró el comando oc."
    exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: No se encontró el comando jq."
    exit 1
fi

if ! oc whoami >/dev/null 2>&1; then
    echo "ERROR: No hay una sesión activa en OpenShift."
    echo "Ejecuta primero el comando oc login correspondiente."
    exit 1
fi

echo "======================================================================"
echo "Buscando deployments en namespaces con patrón: $PATTERN"
echo "CPU expresada en cores y memoria expresada en GiB"
echo "======================================================================"

# ============================================================
# Obtener namespaces
# ============================================================

mapfile -t namespaces < <(
    oc get namespaces \
        -o custom-columns='NAME:.metadata.name' \
        --no-headers 2>/dev/null |
    grep -E "$PATTERN" || true
)

if (( ${#namespaces[@]} == 0 )); then
    echo
    echo "No se encontraron namespaces que coincidan con:"
    echo "$PATTERN"
    exit 0
fi

echo
echo "Namespaces encontrados: ${#namespaces[@]}"

# ============================================================
# Recorrer namespaces
# ============================================================

for ns in "${namespaces[@]}"; do

    echo
    echo "NAMESPACE: $ns"

    printf '%-60s %12s %12s\n' \
        "NAME" \
        "CPU(cores)" \
        "MEM(GiB)"

    printf '%-60s %12s %12s\n' \
        "------------------------------------------------------------" \
        "------------" \
        "------------"

    # Obtener todos los deployments del namespace.
    dep_json="$(
        oc get deployments \
            -n "$ns" \
            -o json 2>/dev/null
    )"

    if [[ -z "$dep_json" ]]; then
        echo "No fue posible consultar los deployments del namespace."
        continue
    fi

    dep_count="$(jq '.items | length' <<< "$dep_json")"

    if [[ "$dep_count" -eq 0 ]]; then
        echo "No hay deployments en este namespace."
        continue
    fi

    # ========================================================
    # Recorrer deployments
    # ========================================================

    while IFS= read -r dep; do

        dep_name="$(
            jq -r '.metadata.name' <<< "$dep"
        )"

        # Construir el selector del deployment.
        selector="$(
            jq -r '
                (
                    .spec.selector.matchLabels
                    // .spec.template.metadata.labels
                    // {}
                )
                | to_entries
                | map("\(.key)=\(.value | tostring)")
                | join(",")
            ' <<< "$dep"
        )"

        if [[ -z "$selector" ]]; then
            printf '%-60s %12s %12s\n' \
                "$dep_name" \
                "-" \
                "-"
            continue
        fi

        # Consultar el consumo de todos los pods correspondientes
        # al deployment.
        metrics="$(
            oc adm top pods \
                -n "$ns" \
                -l "$selector" \
                --no-headers 2>/dev/null || true
        )"

        if [[ -z "$metrics" ]]; then
            printf '%-60s %12s %12s\n' \
                "$dep_name" \
                "-" \
                "-"
            continue
        fi

        # ====================================================
        # Convertir las unidades
        #
        # CPU:
        #   10m = 0.010 cores
        #
        # Memoria:
        #   10Mi = 0.009765625 GiB
        #        = 0.010 GiB redondeado
        # ====================================================

        read -r cpu_total mem_total < <(
            printf '%s\n' "$metrics" |
            awk '
            {
                if (NF < 3) {
                    next
                }

                cpu = $2
                mem = $3

                # Validar que sean métricas reales.
                if (cpu !~ /^[0-9.]+(n|u|m)?$/) {
                    next
                }

                if (mem !~ /^[0-9.]+(Ki|Mi|Gi|Ti)?$/) {
                    next
                }

                # CPU a cores.
                if (cpu ~ /n$/) {
                    sub(/n$/, "", cpu)
                    cpu = cpu / 1000000000
                } else if (cpu ~ /u$/) {
                    sub(/u$/, "", cpu)
                    cpu = cpu / 1000000
                } else if (cpu ~ /m$/) {
                    sub(/m$/, "", cpu)
                    cpu = cpu / 1000
                } else {
                    cpu = cpu + 0
                }

                # Memoria a GiB.
                if (mem ~ /Ki$/) {
                    sub(/Ki$/, "", mem)
                    mem = mem / 1048576
                } else if (mem ~ /Mi$/) {
                    sub(/Mi$/, "", mem)
                    mem = mem / 1024
                } else if (mem ~ /Gi$/) {
                    sub(/Gi$/, "", mem)
                    mem = mem + 0
                } else if (mem ~ /Ti$/) {
                    sub(/Ti$/, "", mem)
                    mem = mem * 1024
                } else {
                    mem = mem + 0
                }

                sum_cpu += cpu
                sum_mem += mem
                rows++
            }

            END {
                if (rows == 0) {
                    print "- -"
                } else {
                    printf "%.3f %.3f\n", sum_cpu, sum_mem
                }
            }'
        )

        printf '%-60s %12s %12s\n' \
            "$dep_name" \
            "$cpu_total" \
            "$mem_total"

    done < <(
        jq -c '.items[]' <<< "$dep_json"
    )

done

echo
echo "Consulta finalizada."
EOF

