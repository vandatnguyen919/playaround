package app.keylab.shared.patch;

import java.util.Map;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * JSON Merge Patch (RFC 7396), the PATCH body of every KeyLab resource
 * (api-design-v1.md, Conventions). Objects merge key by key, null removes,
 * anything else (arrays too) replaces. The target is never changed.
 */
public final class JsonMergePatch {

    private JsonMergePatch() {
    }

    public static JsonNode apply(JsonNode target, JsonNode patch) {
        if (patch == null || !patch.isObject()) {
            return patch;
        }
        ObjectNode result = target != null && target.isObject() ? ((ObjectNode) target).deepCopy()
                : JsonMapper.builder().build().createObjectNode();
        for (Map.Entry<String, JsonNode> entry : patch.properties()) {
            if (entry.getValue().isNull()) {
                result.remove(entry.getKey());
            }
            else {
                result.set(entry.getKey(), apply(result.get(entry.getKey()), entry.getValue()));
            }
        }
        return result;
    }
}
