package app.keylab.builds;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;

import org.jmolecules.archunit.JMoleculesArchitectureRules;
import org.junit.jupiter.api.Test;

/**
 * Ports and adapters inside the builds module (docs/keylab/modulith-plan.md,
 * Package structure), the same rules as CatalogArchitectureTest. Only
 * adapter/out/catalog may reach the catalog module.
 */
class BuildsArchitectureTest {

    private static final String BUILDS = "app.keylab.builds";
    private static final String DOMAIN = BUILDS + ".domain..";
    private static final String APPLICATION = BUILDS + ".application..";
    private static final String QUERY = BUILDS + ".query..";
    private static final String ADAPTER = BUILDS + ".adapter..";
    private static final String WEB = BUILDS + ".adapter.in.web..";
    private static final String TO_CATALOG = BUILDS + ".adapter.out.catalog..";

    private static final JavaClasses CLASSES = new ClassFileImporter()
        .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
        .importPackages(BUILDS);

    @Test
    void followsTheHexagonalAnnotations() {
        JMoleculesArchitectureRules.ensureHexagonal().check(CLASSES);
    }

    @Test
    void domainKnowsNothingOfFrameworksOrAdapters() {
        noClasses().that().resideInAPackage(DOMAIN)
            .should().dependOnClassesThat().resideInAnyPackage("org.springframework..", "tools.jackson..",
                    "com.fasterxml.jackson..", "jakarta..", "app.keylab.shared..", "app.keylab.catalog..", ADAPTER,
                    APPLICATION, QUERY)
            .because("the domain knows nothing about HTTP, JSON, SQL, Spring or other modules")
            .check(CLASSES);
    }

    @Test
    void useCasesDependOnlyOnDomainTypesAndPorts() {
        noClasses().that().resideInAPackage(APPLICATION)
            .should().dependOnClassesThat().resideInAnyPackage("org.springframework.jdbc..",
                    "org.springframework.web..", "org.springframework.http..", "tools.jackson..",
                    "com.fasterxml.jackson..", "jakarta.servlet..", "app.keylab.shared.problem..",
                    "app.keylab.shared.web..", "app.keylab.catalog..", ADAPTER, QUERY)
            .because("use cases load an aggregate through a port, call it and save it")
            .check(CLASSES);
    }

    @Test
    void onlyTheCatalogAdapterTalksToTheCatalog() {
        noClasses().that().resideInAPackage(BUILDS + "..").and().resideOutsideOfPackage(TO_CATALOG)
            .should().dependOnClassesThat().resideInAPackage("app.keylab.catalog..")
            .because("the domain declares PartsCatalog and adapter/out/catalog implements it with CatalogApi")
            .check(CLASSES);
    }

    @Test
    void onlyTheWebAdapterSpeaksProblemJson() {
        noClasses().that().resideInAPackage(BUILDS + "..").and().resideOutsideOfPackage(WEB)
            .should().dependOnClassesThat().resideInAPackage("app.keylab.shared.problem..")
            .because("domain errors become RFC 9457 problems in adapter/in/web (BuildProblems)")
            .check(CLASSES);
    }

    @Test
    void theReadSideIsUsedOnlyByTheWebAdapter() {
        classes().that().resideInAPackage(QUERY)
            .should().onlyHaveDependentClassesThat().resideInAnyPackage(QUERY, WEB)
            .check(CLASSES);
    }
}
