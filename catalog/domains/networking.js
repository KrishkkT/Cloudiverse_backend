/**
 * NETWORKING PACK
 * Advanced networking services.
 * Note: nat_gateway, private_link, service_mesh, service_discovery already in core.js
 */

module.exports = {
    name: 'NETWORKING_PACK',
    description: 'Advanced networking: VPC, VPN, firewalls, load balancing',
    services: {
        // ═════════════════════════════════════════════════════════════════════
        // VIRTUAL NETWORKS
        // ═════════════════════════════════════════════════════════════════════
        vpc: {
            id: 'vpc',
            name: 'Virtual Private Cloud',
            category: 'network',
            domain: 'networking',
            terraform: { moduleId: 'networking' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_vpc', name: 'Amazon VPC' },
                gcp: { resource: 'google_compute_network', name: 'VPC Network' },
                azure: { resource: 'azurerm_virtual_network', name: 'Virtual Network' }
            }
        },
        subnet: {
            id: 'subnet',
            name: 'Subnet',
            category: 'network',
            domain: 'networking',
            terraform: { moduleId: 'networking' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_subnet', name: 'VPC Subnet' },
                gcp: { resource: 'google_compute_subnetwork', name: 'Subnetwork' },
                azure: { resource: 'azurerm_subnet', name: 'Subnet' }
            }
        },

        // ═════════════════════════════════════════════════════════════════════
        // VPN & GATEWAYS
        // ═════════════════════════════════════════════════════════════════════
        vpngateway: {
            id: 'vpngateway',
            name: 'VPN Gateway',
            category: 'network',
            domain: 'networking',
            terraform: { moduleId: 'networking' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_vpn_gateway' } },
            mappings: {
                aws: { resource: 'aws_vpn_gateway', name: 'VPN Gateway' },
                gcp: { resource: 'google_compute_vpn_gateway', name: 'Cloud VPN' },
                azure: { resource: 'azurerm_vpn_gateway', name: 'VPN Gateway' }
            }
        },
        internetgateway: {
            id: 'internetgateway',
            name: 'Internet Gateway',
            category: 'network',
            domain: 'networking',
            terraform: { moduleId: 'networking' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_internet_gateway', name: 'Internet Gateway' },
                gcp: { resource: 'google_compute_router', name: 'Cloud Router' },
                azure: { resource: 'azurerm_public_ip', name: 'Public IP' }
            }
        },
        transitgateway: {
            id: 'transitgateway',
            name: 'Transit Gateway',
            category: 'network',
            domain: 'networking',
            terraform: { moduleId: 'networking' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_ec2_transit_gateway' } },
            mappings: {
                aws: { resource: 'aws_ec2_transit_gateway', name: 'Transit Gateway' },
                gcp: { resource: 'google_compute_interconnect_attachment', name: 'Cloud Interconnect' },
                azure: { resource: 'azurerm_virtual_wan', name: 'Virtual WAN' }
            }
        },

        // ═════════════════════════════════════════════════════════════════════
        // FIREWALLS & SECURITY
        // ═════════════════════════════════════════════════════════════════════
        networkfirewall: {
            id: 'networkfirewall',
            name: 'Network Firewall',
            category: 'network',
            domain: 'networking',
            terraform: { moduleId: 'networking' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_networkfirewall_firewall' } },
            mappings: {
                aws: { resource: 'aws_networkfirewall_firewall', name: 'AWS Network Firewall' },
                gcp: { resource: 'google_compute_firewall', name: 'VPC Firewall Rules' },
                azure: { resource: 'azurerm_firewall', name: 'Azure Firewall' }
            }
        },
        securitygroup: {
            id: 'securitygroup',
            name: 'Security Group',
            category: 'network',
            domain: 'networking',
            terraform: { moduleId: 'networking' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_security_group', name: 'Security Group' },
                gcp: { resource: 'google_compute_firewall', name: 'Firewall Rule' },
                azure: { resource: 'azurerm_network_security_group', name: 'NSG' }
            }
        },

        // ═════════════════════════════════════════════════════════════════════
        // EGRESS & PROXY
        // ═════════════════════════════════════════════════════════════════════
        egressproxy: {
            id: 'egressproxy',
            name: 'Egress Proxy',
            category: 'network',
            domain: 'networking',
            terraform: { moduleId: 'networking' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_vpc_endpoint', name: 'VPC Endpoint Proxy' },
                gcp: { resource: 'google_compute_router_nat', name: 'Cloud NAT Egress' },
                azure: { resource: 'azurerm_nat_gateway', name: 'NAT Gateway Egress' }
            }
        }
    }
};
