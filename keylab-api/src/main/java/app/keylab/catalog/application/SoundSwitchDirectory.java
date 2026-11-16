package app.keylab.catalog.application;

import java.util.Optional;
import java.util.UUID;

import app.keylab.catalog.domain.Switch;
import app.keylab.catalog.persistence.SwitchRepository;
import app.keylab.sound.SwitchDirectory;

import org.springframework.stereotype.Component;

/**
 * Answers the sound module's questions about switches (US-38): does it exist,
 * and is it in the public library. Sound declares the port and catalog fills
 * it, so the dependency stays catalog to sound.
 */
@Component
class SoundSwitchDirectory implements SwitchDirectory {

    private final SwitchRepository switches;

    SoundSwitchDirectory(SwitchRepository switches) {
        this.switches = switches;
    }

    @Override
    public Optional<SwitchRef> find(UUID switchId) {
        return switches.find(switchId)
            .map((sw) -> new SwitchRef(sw.id(), sw.specs().name(), sw.status() == Switch.Status.published));
    }
}
