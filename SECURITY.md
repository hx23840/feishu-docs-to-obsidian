# Security

## Supported Versions

Only the latest release is supported.

## Reporting a Vulnerability

Please open a private security advisory on GitHub if the repository has advisories enabled, or contact the maintainer directly.

## Security Model

This plugin executes the configured `lark-cli` binary on the local machine. Treat the `lark-cli path` setting as trusted configuration.

The plugin does not store Feishu app secrets or access tokens. Authentication is delegated to `lark-cli`.
