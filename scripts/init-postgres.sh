#!/bin/bash

# PostgreSQL initialization script for openskidata-processor

set -e

echo "Starting PostgreSQL initialization..."

# Configure pg_hba.conf for trust authentication
echo "Configuring PostgreSQL authentication..."
tee "/etc/postgresql/15/main/pg_hba.conf" > /dev/null << EOF
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
host    all             all             0.0.0.0/0               trust
EOF

# Run PostgreSQL in foreground as the main process
echo "Starting PostgreSQL in foreground..."
exec su - postgres -c "/usr/lib/postgresql/15/bin/postgres -D /var/lib/postgresql/15/main -c config_file=/etc/postgresql/15/main/postgresql.conf"