'use strict';

const { renderStandardVariables } = require('./base');

const computeVmModule = (provider) => {
    const p = provider.toLowerCase();

    // -------------------------------------------------------------------------
    // AWS - EC2 Instance
    // -------------------------------------------------------------------------
    if (p === 'aws') {
        return {
            mainTf: `
resource "aws_security_group" "vm_sg" {
  name        = "\${var.project_name}-vm-sg"
  description = "Security group for VM instance"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"] # Internal Access Only
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "\${var.project_name}-vm-sg"
  }
}

resource "aws_instance" "main" {
  ami           = var.ami_id
  instance_type = var.instance_type
  subnet_id     = var.subnet_id
  
  vpc_security_group_ids = [aws_security_group.vm_sg.id]

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }

  monitoring = true

  tags = {
    Name        = "\${var.project_name}-vm"
    Environment = var.environment
    ManagedBy   = "Cloudiverse"
  }
}
`.trim(),
            variablesTf: `
${renderStandardVariables('aws')}
variable "vpc_id" { type = string }
variable "subnet_id" { type = string }
variable "instance_type" { 
  type    = string 
  default = "t3.micro" 
}
variable "ami_id" {
  type        = string
  description = "AMI ID (default: Amazon Linux 2023 in us-east-1)"
  default     = "ami-0230bd60aa48260c6" 
}
`.trim(),
            outputsTf: `
output "instance_id" {
  value = aws_instance.main.id
}
output "instance_private_ip" {
  value = aws_instance.main.private_ip
}
`.trim()
        };
    }

    // -------------------------------------------------------------------------
    // GCP - Compute Engine
    // -------------------------------------------------------------------------
    if (p === 'gcp') {
        return {
            mainTf: `
resource "google_compute_instance" "main" {
  name         = "\${var.project_name}-vm"
  machine_type = var.machine_type
  zone         = "\${var.region}-a"

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-11"
      size  = 20
    }
  }

  network_interface {
    network    = "default" # Should be passed as variable in full implementation
    subnetwork = "default"
    
    # access_config {
    #   // Ephemeral public IP - enable if needed
    # }
  }

  service_account {
    scopes = ["cloud-platform"]
  }

  labels = {
    environment = "production"
    managed_by  = "cloudiverse"
  }
}
`.trim(),
            variablesTf: `
${renderStandardVariables('gcp')}
variable "machine_type" {
  type    = string
  default = "e2-micro"
}
`.trim(),
            outputsTf: `
output "instance_name" {
  value = google_compute_instance.main.name
}
output "instance_self_link" {
  value = google_compute_instance.main.self_link
}
`.trim()
        };
    }

    // -------------------------------------------------------------------------
    // Azure - Linux Virtual Machine
    // -------------------------------------------------------------------------
    return {
        mainTf: `
resource "azurerm_network_interface" "main" {
  name                = "\${var.project_name}-nic"
  location            = var.location
  resource_group_name = var.resource_group_name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = var.subnet_id
    private_ip_address_allocation = "Dynamic"
  }
}

resource "azurerm_linux_virtual_machine" "main" {
  name                = "vm-\${var.project_name}"
  resource_group_name = var.resource_group_name
  location            = var.location
  size                = var.vm_size
  admin_username      = "adminuser"
  
  network_interface_ids = [
    azurerm_network_interface.main.id,
  ]

  admin_ssh_key {
    username   = "adminuser"
    public_key = file("~/.ssh/id_rsa.pub") # User needs to replace this
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts"
    version   = "latest"
  }
}
`.trim(),
        variablesTf: `
${renderStandardVariables('azure')}
variable "subnet_id" { type = string }
variable "vm_size" { 
  type    = string 
  default = "Standard_B1s"
}
`.trim(),
        outputsTf: `
output "vm_id" {
  value = azurerm_linux_virtual_machine.main.id
}
output "private_ip" {
  value = azurerm_network_interface.main.private_ip_address
}
`.trim()
    };
};

module.exports = { computeVmModule };
