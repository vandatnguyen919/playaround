package app.keylab.catalog.application;

import java.time.Clock;
import java.util.UUID;

import app.keylab.catalog.domain.Switch;
import app.keylab.catalog.domain.SwitchNotFound;
import app.keylab.catalog.domain.Switches;

import org.jmolecules.architecture.hexagonal.PrimaryPort;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * ADM-03 (US-39): publish a switch to the public library, or pull it out. A
 * switch is published only once its stock press and release recordings are
 * ready; the sound module tells catalog through {@code SoundProcessed}.
 */
@PrimaryPort
@Service
public class PublishSwitch {

    private final Switches switches;
    private final Clock clock;

    @Autowired
    PublishSwitch(Switches switches) {
        this(switches, Clock.systemUTC());
    }

    PublishSwitch(Switches switches, Clock clock) {
        this.switches = switches;
        this.clock = clock;
    }

    /**
     * Publishing again is allowed and resets the New sticker as asked.
     *
     * @throws SwitchNotFound for an unknown id
     * @throws app.keylab.catalog.domain.MissingRequiredSounds unless the stock press and release are ready
     */
    @Transactional
    public void publish(UUID id, boolean markNew, String editor) {
        Switch sw = switches.load(id).orElseThrow(SwitchNotFound::byId);
        sw.publish(markNew, clock.instant(), editor);
        switches.save(sw);
    }

    /**
     * Takes a published switch out of the library. It stays for the builds
     * that use it. A draft or an already pulled switch is left as it is.
     *
     * @throws SwitchNotFound for an unknown id
     */
    @Transactional
    public void unpublish(UUID id, String editor) {
        Switch sw = switches.load(id).orElseThrow(SwitchNotFound::byId);
        sw.unpublish(clock.instant(), editor);
        switches.save(sw);
    }
}
