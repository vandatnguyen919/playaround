package app.keylab.catalog.application;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import app.keylab.catalog.domain.MissingRequiredSounds;
import app.keylab.catalog.domain.Switch;
import app.keylab.catalog.persistence.SwitchRepository;
import app.keylab.shared.UserId;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Publish a switch to the public library, or pull it out (ADM-03, US-39). A
 * switch is published only once its stock press and release recordings are
 * ready; the sound module tells catalog through {@code SoundProcessed}.
 */
@Service
public class SwitchPublication {

    /** How long the New sticker shows. App settings (ADM-11) may make this editable later. */
    public static final Duration NEW_FOR = Duration.ofDays(30);

    private final AdminSwitches admin;
    private final SwitchRepository switches;
    private final Clock clock;

    @Autowired
    SwitchPublication(AdminSwitches admin, SwitchRepository switches) {
        this(admin, switches, Clock.systemUTC());
    }

    SwitchPublication(AdminSwitches admin, SwitchRepository switches, Clock clock) {
        this.admin = admin;
        this.switches = switches;
        this.clock = clock;
    }

    /**
     * Publishing again is allowed and resets the New sticker as asked.
     *
     * @throws ApiProblem 404 switch_not_found, 409 missing_required_sounds
     */
    @Transactional
    public Switch publish(UUID id, boolean markNew, UserId editor) {
        Switch current = admin.get(id);
        Instant now = clock.instant();
        if (!"recorded".equals(current.soundStatus())
                || !switches.publish(id, markNew ? now.plus(NEW_FOR) : null, editor.toString(), now)) {
            throw new MissingRequiredSounds();
        }
        return admin.get(id);
    }

    /**
     * Takes a published switch out of the library. It stays for the builds
     * that use it. A draft or an already pulled switch is left as it is.
     *
     * @throws ApiProblem 404 switch_not_found
     */
    @Transactional
    public void unpublish(UUID id, UserId editor) {
        admin.get(id);
        switches.unpublish(id, editor.toString(), clock.instant());
    }
}
