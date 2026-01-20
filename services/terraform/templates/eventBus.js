'use strict';

const { renderStandardVariables } = require('./base');

const eventBusModule = (provider) => {
    const p = provider.toLowerCase();

    if (p === 'aws') {
        return {
            mainTf: `
resource "aws_cloudwatch_event_bus" "main" {
  name = "\${var.project_name}-bus"

  tags = {
    Environment = var.environment
    ManagedBy   = "Cloudiverse"
  }
}

resource "aws_cloudwatch_event_rule" "main" {
  name           = "\${var.project_name}-rule"
  description    = "Capture all events"
  event_bus_name = aws_cloudwatch_event_bus.main.name

  event_pattern = jsonencode({
    source = ["\${var.project_name}.app"]
  })
}
`.trim(),
            variablesTf: renderStandardVariables('aws'),
            outputsTf: `
output "event_bus_arn" {
  value = aws_cloudwatch_event_bus.main.arn
}
output "event_bus_name" {
  value = aws_cloudwatch_event_bus.main.name
}
`.trim()
        };
    }

    if (p === 'gcp') {
        return {
            mainTf: `
# EventArc requires a destination (Cloud Run usually)
# For this template, we provision a Pub/Sub topic as an intermediary integration point
# since EventArc trigger logic is highly dependent on the source/sink.

resource "google_pubsub_topic" "event_bus" {
  name = "\${var.project_name}-event-bus"

  labels = {
    type        = "event-bus"
    environment = "production"
  }
}
`.trim(),
            variablesTf: renderStandardVariables('gcp'),
            outputsTf: `
output "event_bus_topic" {
  value = google_pubsub_topic.event_bus.id
}
`.trim()
        };
    }

    // Azure Event Grid
    return {
        mainTf: `
resource "azurerm_eventgrid_topic" "main" {
  name                = "eg-\${var.project_name}"
  location            = var.location
  resource_group_name = var.resource_group_name

  tags = {
    Environment = "production"
    ManagedBy   = "Cloudiverse"
  }
}
`.trim(),
        variablesTf: renderStandardVariables('azure'),
        outputsTf: `
output "topic_endpoint" {
  value = azurerm_eventgrid_topic.main.endpoint
}
output "primary_access_key" {
  value     = azurerm_eventgrid_topic.main.primary_access_key
  sensitive = true
}
`.trim()
    };
};

module.exports = { eventBusModule };
