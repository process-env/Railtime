#!/bin/bash
# Railtime v2 — EC2 Bootstrap Script
# Run as root on a fresh EC2 t3.small instance
# Usage: curl -sSL https://raw.githubusercontent.com/your-repo/main/infra/ec2-setup.sh | sudo bash

set -euo pipefail

echo "=== Railtime v2 EC2 Setup ==="

# Update system
echo ">>> Updating system packages..."
apt-get update -y && apt-get upgrade -y

# Install Docker
echo ">>> Installing Docker..."
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start Docker
systemctl enable docker
systemctl start docker

# Add ubuntu user to docker group
usermod -aG docker ubuntu

# Configure firewall (UFW)
echo ">>> Configuring firewall..."
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP (nginx)
ufw allow 443/tcp  # HTTPS (nginx)
ufw allow 3001/tcp # WebSocket server (direct, for testing)
ufw --force enable

# Create app directory
echo ">>> Setting up application directory..."
mkdir -p /opt/railtime
chown ubuntu:ubuntu /opt/railtime

# Configure swap (t3.small has 2GB RAM)
echo ">>> Configuring swap..."
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# System tuning for Docker
echo ">>> Applying system tuning..."
cat >> /etc/sysctl.conf << 'EOF'
# Docker networking
net.core.somaxconn = 1024
net.ipv4.tcp_max_syn_backlog = 1024
# Memory overcommit (for Redis)
vm.overcommit_memory = 1
EOF
sysctl -p

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Clone the repo: cd /opt/railtime && git clone <repo-url> ."
echo "  2. Create .env.v2: cp .env.v2.example .env.v2 && nano .env.v2"
echo "  3. Build and start: docker compose -f infra/docker-compose.prod.yml --env-file .env.v2 up -d --build"
echo "  4. Seed Neo4j: docker compose -f infra/docker-compose.prod.yml exec ws-server npx tsx src/scripts/seed-neo4j.ts"
echo "  5. Check logs: docker compose -f infra/docker-compose.prod.yml logs -f"
echo ""
echo "Memory budget (t3.small = 2GB RAM + 2GB swap):"
echo "  Neo4j:     768MB limit"
echo "  Redis:     300MB limit"
echo "  WS Server: 512MB limit"
echo "  Nginx:     ~50MB"
echo "  System:    ~400MB"
echo ""
