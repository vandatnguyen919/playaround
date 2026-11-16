package app.keylab.sound;

import java.util.Optional;
import java.util.UUID;

/**
 * What the sound module needs to know about a switch, answered by the module
 * that owns switches. Catalog implements it; this module only declares it, so
 * the dependency points from catalog to sound and the modules form no cycle
 * (modulith-plan.md, Module map). After a split it becomes an HTTP call.
 */
public interface SwitchDirectory {

    /** The switch with this id, or empty when there is none. */
    Optional<SwitchRef> find(UUID switchId);

    /**
     * @param id the switch
     * @param name its display name, for logs and messages
     * @param published whether it is in the public library now, so its last stock take cannot be deleted
     */
    record SwitchRef(UUID id, String name, boolean published) {
    }
}
