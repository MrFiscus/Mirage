# Watcher eval

34 labeled tool calls (in_scope / out_of_scope / escape), rules + LLM layer. Run with `npm run watcher:eval`.

| Metric | Count | Rate |
|---|---|---|
| Exact verdict accuracy | 34/34 | 100% |
| Detection recall (threats caught) | 20/20 | 100% |
| Escape → block precision | 12/12 | 100% |
| False positives (in-scope flagged) | 0/14 | 0% |
| Obfuscated evasions caught by LLM | 0 | LLM on |

No misses.
