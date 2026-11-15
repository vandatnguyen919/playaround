package app.keylab;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import org.springframework.modulith.core.ApplicationModule;
import org.springframework.modulith.core.ApplicationModules;
import org.springframework.modulith.docs.Documenter;

/**
 * The module boundaries, enforced by the build (docs/keylab/modulith-plan.md,
 * rule 5): a cycle, or a reach into another module's internals, fails here.
 */
class ModularityTests {

    ApplicationModules modules = ApplicationModules.of(KeylabApplication.class);

    @Test
    void verifiesModularStructure() {
        modules.verify();
    }

    @Test
    void hasTheEightModulesAndShared() {
        assertThat(modules.stream().map(ApplicationModule::getIdentifier).map(Object::toString))
            .containsExactlyInAnyOrder("shared", "catalog", "sound", "builds", "community", "moderation",
                    "account", "billing", "backoffice");
        assertThat(modules.getModuleByName("shared").orElseThrow().isOpen()).isTrue();
    }

    @Test
    void writesDocumentation() {
        new Documenter(modules).writeModulesAsPlantUml().writeIndividualModulesAsPlantUml();
    }
}
