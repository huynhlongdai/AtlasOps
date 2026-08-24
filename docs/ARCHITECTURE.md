# Architecture

AtlasOps is provider-neutral by design.

```text
ChatGPT / Codex / Claude / Gemini / Cursor
                  |
             MCP stdio/HTTP
                  |
              AtlasOps
       +----------+----------+
       | Tool registry       |
       | Policy + audit      |
       | Secret boundary     |
       +----------+----------+
                  |
             SSH / SFTP
                  |
            Managed servers
```

## v0.1 tool surface

- `list_servers`
- `server_info`
- `docker_ps`
- `docker_logs`
- `service_status`
- `read_file`
- `git_status`

All are read-only. Arbitrary shell, writes, restarts and deployments are explicit non-goals until the approval/rollback layer is implemented.
