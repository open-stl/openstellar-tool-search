# Status-only placeholders for MCP servers

A server that is warming, cut, or settled-empty must still be visible to the model, or the model answers "that tool doesn't exist" when asked. We register one placeholder tool per enabled MCP server at init, named after the server, whose description and execute report live status (warming / ready / failed-or-no-tools) by reading provider state. A placeholder is removed when its server settles WITH tools; otherwise it stays for the whole session as the only stable entry point the model can rely on. At pre-warm settle, a kept placeholder is RE-DESCRIBED with the honest status text (failed-to-start / no tools) so the snapshot description is truthful rather than "still starting up".

Considered Options: a forwarding proxy placeholder (rejected — requires a call convention the model must learn, and deadlined servers have nothing to forward); hiding placeholders after the first turn (rejected — opencode never re-reads the tool set, so there is no hook to hide on); no placeholder (rejected — the model cannot discover the server's existence).

Consequences: one placeholder per enabled server costs ~25 tokens each in the snapshot; a server that settles empty keeps a placeholder that honestly reports "failed to start" instead of pretending the server never existed.
