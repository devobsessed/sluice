# Project Instructions

## Behaviors

- When planning a chunk where a `'use client'` file (hook or component) consumes a lib module, trace the import graph for server-only modules (model clients, env-key consumers, node builtins like `child_process`). A client file can never import those - the plan needs a server endpoint seam instead of a direct call. (Learned: story 4 chunk 5 build failure - `usePersonaChat -> thread-compression -> claude/client` forced the compress-thread endpoint amendment.)
