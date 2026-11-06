#!/bin/sh
# vm-ssh-gate.sh with a stand-in for sudo: what the deploy key may and may not run.
# Part of deploy/k8s/jenkins/check.sh.
set -u

here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/bin"
cat > "$tmp/bin/sudo" <<'EOF'
#!/bin/sh
echo "RAN $*"
EOF
chmod +x "$tmp/bin/sudo"
PATH="$tmp/bin:$PATH"

sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
failed=0

allowed() {
  out="$(SSH_ORIGINAL_COMMAND="$1" sh "$here/vm-ssh-gate.sh" 2>&1)" && case "$out" in RAN*) ok=1 ;; *) ok=0 ;; esac || ok=0
  if [ "$ok" = 1 ]; then echo "PASS  allows: $1"; else echo "FAIL  should allow: $1 ($out)"; failed=1; fi
}
refused() {
  out="$(SSH_ORIGINAL_COMMAND="$1" sh "$here/vm-ssh-gate.sh" 2>&1)"
  code=$?
  if [ "$code" = 126 ] && [ "${out#RAN}" = "$out" ]; then echo "PASS  refuses: $1"; else echo "FAIL  should refuse: $1 (exit $code, $out)"; failed=1; fi
}

allowed "deploy $sha $digest $digest $digest deploy-playground/12"
allowed "rollback rollback-playground/3"
allowed "mark-good $sha deploy-playground/12"
allowed "note $sha rollback-verified deploy-playground/12"
allowed "current"
allowed "history"
allowed "sudo sh $here/smoke-access.sh hosts"
allowed "sudo sh $here/smoke-access.sh open"
allowed "sudo sh $here/smoke-access.sh close"
allowed "sudo sh $here/smoke-access.sh redis-exists spring:session:sessions:abc-1"

refused ""
refused "id"
refused "sh"
refused "bash -c id"
refused "cat .env"
refused "sudo id"
refused "sudo cat $here/.env"
refused "sudo sh /tmp/evil.sh hosts"
refused "sudo sh $here/smoke-access.sh marker drill-a@example.com"
refused "sudo sh $here/smoke-access.sh address gateway"
refused "sudo sh $here/smoke-access.sh hosts extra"
refused "sudo sh $here/vm-deploy.sh add-deploy-key"
refused "add-deploy-key"
refused "current; id"
refused "current && id"
refused "current | id"
refused "current \$(id)"
refused "current \`id\`"
refused "history > /tmp/x"
refused "deploy $sha 'x'"
refused "scp -t /tmp"
refused "rsync --server . /"

exit "$failed"
