#!/usr/bin/env bash
# Render Build Script — installs dependencies + Terraform

set -e

echo "=== Installing Node dependencies ==="
npm install

echo "=== Installing Terraform ==="
TERRAFORM_VERSION="1.7.5"
cd /tmp
curl -fsSL "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip" -o terraform.zip
unzip -o terraform.zip
mv terraform /opt/render/project/src/terraform_bin
chmod +x /opt/render/project/src/terraform_bin
cd /opt/render/project/src

echo "=== Terraform installed ==="
/opt/render/project/src/terraform_bin --version
