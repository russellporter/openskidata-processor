#!/bin/bash

# PostgreSQL initialization script for openskidata-processor

set -e

echo "Starting PostgreSQL initialization..."

# Configure PostgreSQL to listen on all addresses
echo "Configuring PostgreSQL to listen on all addresses..."
# Needs to be done each time as the data dir doesnt hold this file
sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" /etc/postgresql/17/main/postgresql.conf

# Configure authentication based on whether custom user/password are set
if [ -n "$POSTGRES_USER" ] && [ -n "$POSTGRES_PASSWORD" ]; then
    echo "Configuring PostgreSQL with password authentication..."
    # Needs to be done each time as the data dir doesnt hold this file
    tee "/etc/postgresql/17/main/pg_hba.conf" > /dev/null << EOF
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     trust
host    all             all             127.0.0.1/32            md5
host    all             all             ::1/128                 md5
host    all             all             0.0.0.0/0               md5
EOF
else
    echo "Configuring PostgreSQL with trust authentication..."
    tee "/etc/postgresql/17/main/pg_hba.conf" > /dev/null << EOF
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
host    all             all             0.0.0.0/0               trust
EOF
fi

# Update PostgreSQL config to use the data directory
sed -i "s|data_directory = '/var/lib/postgresql/17/main'|data_directory = '/var/lib/postgresql/data'|" /etc/postgresql/17/main/postgresql.conf

# Initialize PostgreSQL if not already initialized
if [ ! -f /var/lib/postgresql/data/PG_VERSION ]; then
    echo "Initializing PostgreSQL database..."
    echo "Setting up data directory permissions..."
    chown -R postgres:postgres /var/lib/postgresql/data
    chmod 700 /var/lib/postgresql/data
    su - postgres -c "/usr/lib/postgresql/17/bin/initdb -D /var/lib/postgresql/data"

    # Start PostgreSQL temporarily to create user if needed
    echo "Starting PostgreSQL for initialization..."
    if ! su - postgres -c "/usr/lib/postgresql/17/bin/pg_ctl -D /var/lib/postgresql/data -l /var/log/postgresql/postgresql-17-main.log start"; then
        echo "ERROR: Failed to start PostgreSQL"
        echo "Startup logs:"
        cat /var/log/postgresql/postgresql-17-main.log 2>&1 || echo "Log file not found"
        exit 1
    fi

    # Wait for PostgreSQL to be ready
    echo "Waiting for PostgreSQL to be ready..."
    for i in {1..30}; do
        if su - postgres -c "pg_isready -q"; then
            echo "PostgreSQL is ready"
            break
        fi
        if [ $i -eq 30 ]; then
            echo "ERROR: PostgreSQL failed to become ready within 30 seconds"
            echo "Startup logs:"
            cat /var/log/postgresql/postgresql-17-main.log 2>&1 || echo "Log file not found"
            exit 1
        fi
        sleep 1
    done
    
    # Create custom user if environment variables are set
    if [ -n "$POSTGRES_USER" ] && [ -n "$POSTGRES_PASSWORD" ]; then
        echo "Creating custom user: $POSTGRES_USER"
        su - postgres -c "psql -c \"CREATE USER $POSTGRES_USER WITH PASSWORD '$POSTGRES_PASSWORD' SUPERUSER;\""
    fi

    # Create application databases
    echo "Creating application databases..."
    su - postgres -c "psql -c \"CREATE DATABASE openskidata_cache;\""
    su - postgres -c "psql -c \"CREATE DATABASE openskidata_test;\""
    
    # Enable PostGIS extension on both databases
    echo "Enabling PostGIS extensions..."
    su - postgres -c "psql -c \"CREATE EXTENSION IF NOT EXISTS postgis;\" openskidata_cache"
    su - postgres -c "psql -c \"CREATE EXTENSION IF NOT EXISTS postgis;\" openskidata_test"
    
    # Stop PostgreSQL
    su - postgres -c "/usr/lib/postgresql/17/bin/pg_ctl -D /var/lib/postgresql/data stop"
fi

# Start PostgreSQL as the main process
echo "Starting PostgreSQL..."
if ! su - postgres -c "/usr/lib/postgresql/17/bin/pg_ctl -D /var/lib/postgresql/data -l /var/log/postgresql/postgresql-17-main.log start"; then
    echo "ERROR: Failed to start PostgreSQL"
    echo "Startup logs:"
    cat /var/log/postgresql/postgresql-17-main.log 2>&1 || echo "Log file not found"
    exit 1
fi

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
for i in {1..30}; do
    if su - postgres -c "pg_isready -q"; then
        echo "PostgreSQL is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "ERROR: PostgreSQL failed to become ready within 30 seconds"
        echo "Startup logs:"
        cat /var/log/postgresql/postgresql-17-main.log 2>&1 || echo "Log file not found"
        exit 1
    fi
    sleep 1
done

# Clean up clustering databases older than 1 day
echo "Checking for old clustering databases to clean up..."
su - postgres -c "psql -At -c \"SELECT 'DROP DATABASE IF EXISTS \\\"' || datname || '\\\";' FROM pg_database WHERE datname LIKE 'clustering-%' AND (pg_stat_file('base/'||oid ||'/PG_VERSION')).modification < NOW() - INTERVAL '1 day'\" | psql"

# Keep container running by tailing PostgreSQL logs
echo "PostgreSQL initialization complete. Tailing logs..."
exec tail -f /var/log/postgresql/postgresql-17-main.log
