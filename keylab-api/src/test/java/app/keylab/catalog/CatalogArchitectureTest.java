package app.keylab.catalog;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;

import org.jmolecules.archunit.JMoleculesArchitectureRules;
import org.junit.jupiter.api.Test;

/**
 * Ports and adapters inside the catalog module (docs/keylab/modulith-plan.md,
 * Package structure). jMolecules checks the hexagonal annotations on the
 * packages and port types; the rules below name the imports each layer may
 * not have. No Spring context: the classes are read from the build output.
 */
class CatalogArchitectureTest {

    private static final String CATALOG = "app.keylab.catalog";
    private static final String DOMAIN = CATALOG + ".domain..";
    private static final String APPLICATION = CATALOG + ".application..";
    private static final String QUERY = CATALOG + ".query..";
    private static final String ADAPTER = CATALOG + ".adapter..";
    private static final String WEB = CATALOG + ".adapter.in.web..";

    private static final JavaClasses CLASSES = new ClassFileImporter()
        .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
        .importPackages(CATALOG);

    @Test
    void followsTheHexagonalAnnotations() {
        JMoleculesArchitectureRules.ensureHexagonal().check(CLASSES);
    }

    @Test
    void domainKnowsNothingOfFrameworksOrAdapters() {
        noClasses().that().resideInAPackage(DOMAIN)
            .should().dependOnClassesThat().resideInAnyPackage("org.springframework..", "tools.jackson..",
                    "com.fasterxml.jackson..", "jakarta..", "app.keylab.shared.problem..",
                    "app.keylab.shared.web..", ADAPTER, APPLICATION, QUERY)
            .because("the domain knows nothing about HTTP, JSON, SQL or Spring")
            .check(CLASSES);
    }

    @Test
    void useCasesDependOnlyOnDomainTypesAndPorts() {
        noClasses().that().resideInAPackage(APPLICATION)
            // Kept only so the pre-KL-R1 AdminSwitchesTest runs unedited; nothing in main calls it.
            .and().doNotHaveSimpleName("AdminSwitches")
            .should().dependOnClassesThat().resideInAnyPackage("org.springframework.jdbc..",
                    "org.springframework.web..", "org.springframework.http..", "tools.jackson..",
                    "com.fasterxml.jackson..", "jakarta.servlet..", "app.keylab.shared.problem..",
                    "app.keylab.shared.web..", ADAPTER, QUERY)
            .because("use cases load an aggregate through a port, call it and save it")
            .check(CLASSES);
    }

    @Test
    void onlyTheWebAdapterSpeaksProblemJson() {
        noClasses().that().resideInAPackage(CATALOG + "..").and().resideOutsideOfPackage(WEB)
            .should().dependOnClassesThat().resideInAPackage("app.keylab.shared.problem..")
            .because("domain errors become RFC 9457 problems in adapter/in/web (CatalogProblems)")
            .check(CLASSES);
    }

    @Test
    void theReadSideIsUsedOnlyByTheWebAdapter() {
        classes().that().resideInAPackage(QUERY)
            .should().onlyHaveDependentClassesThat().resideInAnyPackage(QUERY, WEB)
            .check(CLASSES);
    }
}
