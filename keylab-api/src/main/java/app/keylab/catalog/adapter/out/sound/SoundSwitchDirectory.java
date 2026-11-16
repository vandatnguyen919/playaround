package app.keylab.catalog.adapter.out.sound;

import java.util.Optional;
import java.util.UUID;

import app.keylab.catalog.domain.Switches;
import app.keylab.sound.SwitchDirectory;

import org.springframework.stereotype.Component;

/**
 * Answers the sound module's questions about switches (US-38): does it exist,
 * and is it in the public library. Sound declares the port and catalog fills
 * it, so the dependency stays catalog to sound.
 */
@Component
class SoundSwitchDirectory implements SwitchDirectory {

    private final Switches switches;

    SoundSwitchDirectory(Switches switches) {
        this.switches = switches;
    }

    @Override
    public Optional<SwitchRef> find(UUID switchId) {
        return switches.load(switchId).map((sw) -> new SwitchRef(sw.id(), sw.specs().name(), sw.isPublished()));
    }
}
