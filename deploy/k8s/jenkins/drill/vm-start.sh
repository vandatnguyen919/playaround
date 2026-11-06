#!/bin/sh
# Drill only. Makes a Docker-in-Docker container behave like the VM where it counts: user
# playground with sudo, sshd with the same rules as cloud-init (key only, AllowUsers, local
# forwarding only), and its own Docker with the fixture registry's CA.
set -eu

# --upgrade: the image's own openssh-client is older than the server Alpine now offers.
apk add --no-cache -q --upgrade openssh-client-default openssh-server sudo curl openssl tar

id playground >/dev/null 2>&1 || adduser -D -s /bin/sh playground
echo 'playground:*' | chpasswd -e 2>/dev/null
echo 'playground ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/playground

ssh-keygen -A >/dev/null
cat > /etc/ssh/sshd_config <<EOF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowUsers playground
AllowTcpForwarding local
X11Forwarding no
EOF
/usr/sbin/sshd

mkdir -p /etc/docker/certs.d/registry.drill.test:5000
cp /ca.pem /etc/docker/certs.d/registry.drill.test:5000/ca.crt

exec dockerd-entrypoint.sh
