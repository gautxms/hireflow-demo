# Admin AI Settings API Contract

## GET `/api/admin/ai-settings`

### Response (200)

```json
{
  "activeProvider": "anthropic",
  "metadata": {},
  "providers": {
    "anthropic": {
      "provider": "anthropic",
      "defaultModel": "claude-3-5-sonnet-20241022",
      "allowedModels": ["claude-3-5-sonnet-20241022"],
      "primary": {
        "configured": true,
        "maskedApiKey": "sk-a****1bcd",
        "model": "claude-3-5-sonnet-20241022",
        "isActive": true,
        "updatedAt": "2026-04-21T10:08:17.772Z"
      },
      "fallback": {
        "configured": false,
        "maskedApiKey": null,
        "model": "claude-3-5-sonnet-20241022",
        "isActive": true,
        "updatedAt": null
      }
    },
    "openai": {
      "provider": "openai",
      "defaultModel": "gpt-4o-mini",
      "allowedModels": ["gpt-4o-mini"],
      "primary": {
        "configured": false,
        "maskedApiKey": null,
        "model": "gpt-4o-mini",
        "isActive": true,
        "updatedAt": null
      },
      "fallback": {
        "configured": false,
        "maskedApiKey": null,
        "model": "gpt-4o-mini",
        "isActive": true,
        "updatedAt": null
      }
    }
  }
}
```

## PUT `/api/admin/ai-settings`

### Request

```json
{
  "activeProvider": "openai",
  "metadata": {
    "notes": "Switched after load test"
  },
  "providers": {
    "anthropic": {
      "primary": {
        "apiKey": "sk-ant-...",
        "model": "claude-3-5-sonnet-20241022"
      },
      "fallback": {
        "apiKey": "",
        "model": "claude-3-5-sonnet-20241022"
      }
    },
    "openai": {
      "primary": {
        "apiKey": "sk-openai-...",
        "model": "gpt-4o-mini"
      },
      "fallback": {
        "apiKey": "",
        "model": "gpt-4.1-mini"
      }
    }
  }
}
```

### Validation rules

- `activeProvider` must be one of `anthropic` or `openai`.
- `providers` must be an object containing only supported provider keys.
- For any supplied `providers.<provider>.<keyLabel>` object (`primary` or `fallback`), `.model` is required.
- At least one API key must already exist or be supplied in the request.

### Response (200)

```json
{
  "ok": true,
  "settings": {
    "activeProvider": "openai",
    "metadata": {
      "notes": "Switched after load test"
    },
    "providers": {
      "anthropic": { "...": "..." },
      "openai": { "...": "..." }
    }
  },
  "activeProviderUpdated": true,
  "providers": {
    "anthropic": {
      "primaryKeyUpdated": false,
      "fallbackKeyUpdated": false,
      "primaryModelUpdated": false,
      "fallbackModelUpdated": false
    },
    "openai": {
      "primaryKeyUpdated": true,
      "fallbackKeyUpdated": false,
      "primaryModelUpdated": true,
      "fallbackModelUpdated": true
    }
  }
}
```

## Backward compatibility

Legacy flat payloads are still accepted and mapped to `providers.anthropic`:

```json
{
  "primaryApiKey": "sk-ant-...",
  "fallbackApiKey": "",
  "primaryModel": "claude-3-5-sonnet-20241022",
  "fallbackModel": "claude-3-5-sonnet-20241022"
}
```
