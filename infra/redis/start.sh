#!/bin/sh
# Writes the ACL file from REDIS_PASSWORD, so the password lives only in the
# environment (.env), never in git or the image, then starts Redis through the
# image's entrypoint (which drops to the redis user).
set -eu
: "${REDIS_PASSWORD:?set REDIS_PASSWORD}"

mkdir -p /run/redis
umask 077
# default: off, no password, no commands. gateway: only its key prefixes, no
# pub/sub, and no dangerous commands (FLUSHALL, KEYS, CONFIG, DEBUG, ...)
# except INFO, which the actuator health check uses.
cat > /run/redis/users.acl <<ACL
user default off resetpass resetkeys resetchannels -@all
user gateway on >${REDIS_PASSWORD} resetchannels ~spring:session:* ~playground:* ~request_rate_limiter.* +@all -@dangerous +info
ACL
chown -R redis:redis /run/redis

exec docker-entrypoint.sh redis-server /usr/local/etc/redis/redis.conf --aclfile /run/redis/users.acl
