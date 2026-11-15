package app.keylab.shared.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import app.keylab.testing.IntegrationTest;

import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.context.ApplicationContext;

/** One Postgres schema per module, each migrated by its own Flyway, plus "platform". */
class ModuleMigrationsTest extends IntegrationTest {

    @Autowired
    JdbcClient jdbc;

    @Autowired
    ApplicationContext context;

    @Test
    void everyModuleHasItsOwnSchemaAndFlywayHistory() {
        List<String> modules = List.of("catalog", "sound", "builds", "community", "moderation", "account",
                "billing", "backoffice");
        assertThat(ModuleMigrations.SCHEMAS).containsExactlyInAnyOrderElementsOf(
                java.util.stream.Stream.concat(modules.stream(), java.util.stream.Stream.of("platform")).toList());

        for (String schema : ModuleMigrations.SCHEMAS) {
            List<String> applied = jdbc
                .sql("SELECT script FROM " + schema + ".flyway_schema_history WHERE success ORDER BY installed_rank")
                .query(String.class).list();
            assertThat(applied).as("migrations applied in schema %s", schema)
                .contains("V1__" + schema + "_schema.sql");
        }
    }

    @Test
    void nothingLandsInThePublicSchema() {
        assertThat(jdbc.sql("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
            .query(Integer.class).single()).isZero();
    }

    @Test
    void platformHoldsTheIdempotencyAndEventPublicationTables() {
        assertThat(jdbc.sql("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'platform' AND table_name <> 'flyway_schema_history' ORDER BY table_name
                """).query(String.class).list()).containsExactly("event_publication", "idempotency_keys");
    }

    @Test
    void theEventPublicationRegistryReadsItsTableInPlatform() throws Exception {
        // The registry is a runtime dependency (spring-modulith-starter-jdbc), so it is reached by name.
        // Fails with "relation event_publication does not exist" if Modulith looked anywhere else.
        Class<?> type = Class.forName("org.springframework.modulith.events.core.EventPublicationRegistry");
        Object registry = context.getBean(type);
        assertThat((java.util.Collection<?>) type.getMethod("findIncompletePublications").invoke(registry)).isEmpty();
    }
}
