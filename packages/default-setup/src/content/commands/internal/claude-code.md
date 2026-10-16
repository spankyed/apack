---
name: Claude Code commands
---
<!-- section:field -->
**cc-sessions**: Session ID (optional, lists all if omitted)
**cc-config**: get|set <key> [value]
**cc-plan**: Show the current native plan without a model turn
**cc-context**: Show context window usage breakdown
**cc-status**: Show version and auth info
**cc-model**: Model name (optional, shows current if omitted)
**cc-memory**: File name or add|remove <name>
**cc-recap**: Summarize current conversation
**cc-skills**: List installed skills
**cc-compact**: Custom instructions (optional, summarize context)
**cc-resume**: Session ID (optional, lists sessions if omitted)
**cc-import**: [all] [no-limit] (imports up to 50 from current dir by default; "all" imports from all dirs; "no-limit" removes cap)
**cc-add-dir**: <path> [--remember]
**cc-set-dir**: <path> (set working directory for new threads)
**cc-rename**: New name (optional, auto-generates if omitted)
**cc-fork**: Fork from last assistant message
**cc-stats**: Show version, auth, and config info
**cc-doctor**: Diagnose installation
**cc-mcp**: Manage MCP servers
**cc-agents**: List configured agents
**cc-bypass**: Toggle bypass permissions mode
**cc-goal**: <condition> | clear | (no args for status)
