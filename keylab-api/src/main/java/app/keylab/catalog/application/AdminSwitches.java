package app.keylab.catalog.application;

import app.keylab.catalog.domain.Slug;
import app.keylab.shared.patch.JsonMergePatch;

import tools.jackson.databind.JsonNode;

/**
 * What {@code AdminSwitchesTest} checks from before KL-R1, when the ADM-02
 * use cases lived in one class here. KL-R1 keeps that test unedited, so the
 * two helpers stay reachable under their old names. The code lives in
 * {@link JsonMergePatch} and {@link Slug}; nothing in main calls this class.
 */
final class AdminSwitches {

    private AdminSwitches() {
    }

    static JsonNode mergePatch(JsonNode target, JsonNode patch) {
        return JsonMergePatch.apply(target, patch);
    }

    static String slugBase(String name) {
        return Slug.base(name);
    }
}
