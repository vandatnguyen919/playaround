#!/usr/bin/env bash
# Can a container on a user-defined network reach a port on the runner through
# host.docker.internal (host-gateway)? Keycloak needs that for back-channel
# logout to the gateway, in Testcontainers and in the compose stack.
# Prints the result and the INPUT rules. If the first try fails, it accepts
# traffic from Docker bridges in INPUT and tries again. Exits 1 if still blocked.
set -u
PORT=18999
python3 -m http.server "$PORT" --bind 0.0.0.0 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; docker network rm host-reach >/dev/null 2>&1' EXIT
docker network create host-reach >/dev/null
sleep 1

probe() {
  docker run --rm --network host-reach --add-host host.docker.internal:host-gateway \
    busybox:1.37.0 wget -q -T 5 -O /dev/null "http://host.docker.internal:$PORT/"
}

echo "host-gateway: $(docker run --rm --add-host host.docker.internal:host-gateway busybox:1.37.0 grep host.docker.internal /etc/hosts)"
if probe; then
  echo "container -> host:$PORT reachable"
  exit 0
fi
echo "container -> host:$PORT NOT reachable. INPUT rules:"
sudo iptables -S INPUT
sudo iptables -I INPUT -i docker0 -j ACCEPT
sudo iptables -I INPUT -i br-+ -j ACCEPT
if probe; then
  echo "reachable after accepting Docker bridges in INPUT"
  exit 0
fi
echo "still not reachable"
exit 1
