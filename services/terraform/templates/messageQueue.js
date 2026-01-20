'use strict';

const { renderStandardVariables } = require('./base');

const messageQueueModule = (provider) => {
    const p = provider.toLowerCase();

    // -------------------------------------------------------------------------
    // AWS - SQS
    // -------------------------------------------------------------------------
    if (p === 'aws') {
        return {
            mainTf: `
resource "aws_sqs_queue" "main" {
  name                      = "\${var.project_name}-queue"
  delay_seconds             = 0
  max_message_size          = 262144
  message_retention_seconds = 345600
  receive_wait_time_seconds = 0
  visibility_timeout_seconds = 30
  
  # Dead Letter Queue
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 4
  })

  tags = {
    Environment = var.environment
    ManagedBy   = "Cloudiverse"
  }
}

resource "aws_sqs_queue" "dlq" {
  name = "\${var.project_name}-dlq"
}
`.trim(),
            variablesTf: renderStandardVariables('aws'),
            outputsTf: `
output "queue_url" {
  value = aws_sqs_queue.main.id
}
output "queue_arn" {
  value = aws_sqs_queue.main.arn
}
`.trim()
        };
    }

    // -------------------------------------------------------------------------
    // GCP - Pub/Sub
    // -------------------------------------------------------------------------
    if (p === 'gcp') {
        return {
            mainTf: `
resource "google_pubsub_topic" "main" {
  name = "\${var.project_name}-topic"

  labels = {
    environment = "production"
    managed_by  = "cloudiverse"
  }
}

resource "google_pubsub_subscription" "main" {
  name  = "\${var.project_name}-sub"
  topic = google_pubsub_topic.main.name

  ack_deadline_seconds = 20
}
`.trim(),
            variablesTf: renderStandardVariables('gcp'),
            outputsTf: `
output "topic_id" {
  value = google_pubsub_topic.main.id
}
output "subscription_id" {
  value = google_pubsub_subscription.main.id
}
`.trim()
        };
    }

    // -------------------------------------------------------------------------
    // Azure - Service Bus
    // -------------------------------------------------------------------------
    return {
        mainTf: `
resource "azurerm_servicebus_namespace" "main" {
  name                = "sb-\${var.project_name}"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "Standard"

  tags = {
    Environment = "production"
    ManagedBy   = "Cloudiverse"
  }
}

resource "azurerm_servicebus_queue" "main" {
  name         = "\${var.project_name}-queue"
  namespace_id = azurerm_servicebus_namespace.main.id

  enable_partitioning = true
}
`.trim(),
        variablesTf: renderStandardVariables('azure'),
        outputsTf: `
output "namespace_name" {
  value = azurerm_servicebus_namespace.main.name
}
output "queue_id" {
  value = azurerm_servicebus_queue.main.id
}
`.trim()
    };
};

module.exports = { messageQueueModule };
