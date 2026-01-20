'use strict';

const { renderStandardVariables } = require('./base');

const workflowOrchestrationModule = (provider) => {
    const p = provider.toLowerCase();

    if (p === 'aws') {
        return {
            mainTf: `
resource "aws_iam_role" "sfn" {
  name = "\${var.project_name}-sfn-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "states.amazonaws.com" }
    }]
  })
}

resource "aws_sfn_state_machine" "main" {
  name     = "\${var.project_name}-workflow"
  role_arn = aws_iam_role.sfn.arn

  definition = <<EOF
{
  "Comment": "A Hello World example",
  "StartAt": "HelloWorld",
  "States": {
    "HelloWorld": {
      "Type": "Pass",
      "Result": "Hello World!",
      "End": true
    }
  }
}
EOF

  tags = {
    Environment = var.environment
  }
}
`.trim(),
            variablesTf: renderStandardVariables('aws'),
            outputsTf: `
output "state_machine_arn" {
  value = aws_sfn_state_machine.main.arn
}
`.trim()
        };
    }

    if (p === 'gcp') {
        return {
            mainTf: `
resource "google_service_account" "workflows" {
  account_id   = "\${var.project_name}-workflow-sa"
  display_name = "Workflows Service Account"
}

resource "google_workflows_workflow" "main" {
  name          = "\${var.project_name}-workflow"
  region        = var.region
  description   = "A sample workflow"
  service_account = google_service_account.workflows.id

  source_contents = <<EOF
- getCurrentTime:
    call: http.get
    args:
        url: https://us-central1-workflow-sample.cloudfunctions.net/datetime
    result: currentTime
- returnResult:
    return: \${currentTime.body}
EOF
}
`.trim(),
            variablesTf: renderStandardVariables('gcp'),
            outputsTf: `
output "workflow_id" {
  value = google_workflows_workflow.main.id
}
`.trim()
        };
    }

    // Azure Logic App
    return {
        mainTf: `
resource "azurerm_logic_app_workflow" "main" {
  name                = "la-\${var.project_name}"
  location            = var.location
  resource_group_name = var.resource_group_name

  tags = {
    Environment = "production"
  }
}
`.trim(),
        variablesTf: renderStandardVariables('azure'),
        outputsTf: `
output "logic_app_id" {
  value = azurerm_logic_app_workflow.main.id
}
`.trim()
    };
};

module.exports = { workflowOrchestrationModule };
