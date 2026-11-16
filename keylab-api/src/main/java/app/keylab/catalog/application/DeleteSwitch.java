package app.keylab.catalog.application;

import java.util.UUID;

import app.keylab.catalog.application.EditSwitch.VersionCheck;
import app.keylab.catalog.domain.Switch;
import app.keylab.catalog.domain.SwitchNotFound;
import app.keylab.catalog.domain.Switches;

import org.springframework.stereotype.Service;

/**
 * ADM-02 delete (US-37), for drafts only: a published switch may be in
 * someone's build, so it is pulled from the library (ADM-03) instead.
 */
@Service
public class DeleteSwitch {

    private final Switches switches;

    DeleteSwitch(Switches switches) {
        this.switches = switches;
    }

    /**
     * @throws SwitchNotFound for an unknown id
     * @throws app.keylab.catalog.domain.SwitchNotDraft for a published or pulled switch
     * @throws app.keylab.catalog.domain.SwitchChangedMeanwhile when it changed since the check
     */
    public void delete(UUID id, VersionCheck versionCheck) {
        Switch sw = switches.load(id).orElseThrow(SwitchNotFound::byId);
        versionCheck.check(sw.version());
        sw.delete();
        switches.remove(sw);
    }
}
