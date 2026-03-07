Help me debug the Claude usage API connection:

1. Check if we can read the OAuth token from the keychain by examining what `security find-generic-password -s "Claude Code-credentials" -w` returns (DO NOT print the actual token — just confirm it exists and has the expected shape)
2. If the token exists, check if the API endpoint `https://api.anthropic.com/api/oauth/usage` responds correctly
3. If there are errors (401, 403, network), suggest fixes
4. Show me the raw API response shape (redact any sensitive fields)
