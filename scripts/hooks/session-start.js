#!/usr/bin/env node

// =============================================================================
// agent-knowledge SessionStart hook
//
// Announces the knowledge dashboard URL.
// =============================================================================

const knowledgePort = process.env.AGENT_KNOWLEDGE_PORT || '3423';

const msg = {
  systemMessage: `agent-knowledge: http://localhost:${knowledgePort}`,
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: `Knowledge: http://localhost:${knowledgePort}`,
  },
};

console.log(JSON.stringify(msg));
