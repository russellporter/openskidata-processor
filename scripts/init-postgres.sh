#!/bin/bash

# PostgreSQL initialization script for openskidata-processor

set -e

echo "Starting PostgreSQL initialization..."

# Configure PostgreSQL to listen on all addresses
echo "Configuring PostgreSQL to listen on all addresses..."
sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" /etc/postgresql/15/main/postgresql.conf

# Configure authentication based on whether custom user/password are set
if [ -n "$POSTGRES_USER" ] && [ -n "$POSTGRES_PASSWORD" ]; then
    echo "Configuring PostgreSQL with password authentication..."
    tee "/etc/postgresql/15/main/pg_hba.conf" > /dev/null << EOF
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     trust
host    all             all             127.0.0.1/32            md5
host    all             all             ::1/128                 md5
host    all             all             0.0.0.0/0               md5
EOF
else
    echo "Configuring PostgreSQL with trust authentication..."
    tee "/etc/postgresql/15/main/pg_hba.conf" > /dev/null << EOF
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
host    all             all             0.0.0.0/0               trust
EOF
fi

# Initialize PostgreSQL if not already initialized
if [ ! -f /var/lib/postgresql/data/PG_VERSION ]; then
    echo "Initializing PostgreSQL database..."
    su - postgres -c "/usr/lib/postgresql/15/bin/initdb -D /var/lib/postgresql/data"
    
    # Update PostgreSQL config to use the data directory
    sed -i "s|data_directory = '/var/lib/postgresql/15/main'|data_directory = '/var/lib/postgresql/data'|" /etc/postgresql/15/main/postgresql.conf
    
    # Start PostgreSQL temporarily to create user if needed
    su - postgres -c "/usr/lib/postgresql/15/bin/pg_ctl -D /var/lib/postgresql/data -l /var/log/postgresql/postgresql-15-main.log start"
    
    # Wait for PostgreSQL to start
    sleep 5
    
    # Create custom user if environment variables are set
    if [ -n "$POSTGRES_USER" ] && [ -n "$POSTGRES_PASSWORD" ]; then
        echo "Creating custom user: $POSTGRES_USER"
        su - postgres -c "psql -c \"CREATE USER $POSTGRES_USER WITH PASSWORD '$POSTGRES_PASSWORD' SUPERUSER;\""
    fi
    
    # Stop PostgreSQL
    su - postgres -c "/usr/lib/postgresql/15/bin/pg_ctl -D /var/lib/postgresql/data stop"
fi

# Run PostgreSQL in foreground as the main process
echo "Starting PostgreSQL in foreground..."
exec su - postgres -c "/usr/lib/postgresql/15/bin/postgres -D /var/lib/postgresql/data -c config_file=/etc/postgresql/15/main/postgresql.conf"