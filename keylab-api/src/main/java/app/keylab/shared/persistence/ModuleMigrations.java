package app.keylab.shared.persistence;

import java.util.List;

import javax.sql.DataSource;

import jakarta.persistence.EntityManagerFactory;

import org.flywaydb.core.Flyway;

import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.StringUtils;

/**
 * One Postgres schema per module, each with its own Flyway history
 * ({@code <schema>.flyway_schema_history}) and its own scripts under
 * {@code db/migration/<schema>/}. A module that is split out later takes its
 * schema and its folder with it; nothing else has to be untangled
 * (docs/keylab/modulith-plan.md, rule 1).
 *
 * "platform" is not a module: it holds the infrastructure tables that belong
 * to none (idempotency keys, Spring Modulith's event publication registry).
 */
@Configuration(proxyBeanMethods = false)
public class ModuleMigrations {

    /** Migration order. platform first: every module may use its tables. */
    public static final List<String> SCHEMAS = List.of("platform", "catalog", "sound", "builds", "community",
            "moderation", "account", "billing", "backoffice");

    private static final String BEAN = "moduleMigrator";

    /** Runs every schema's migrations at startup, before anything reads the database. */
    public static final class Migrator {

        Migrator(DataSource dataSource) {
            for (String schema : SCHEMAS) {
                Flyway.configure()
                    .dataSource(dataSource)
                    .schemas(schema)
                    .defaultSchema(schema)
                    .createSchemas(true)
                    .locations("classpath:db/migration/" + schema)
                    .load()
                    .migrate();
            }
        }
    }

    @Bean(BEAN)
    Migrator moduleMigrator(DataSource dataSource) {
        return new Migrator(dataSource);
    }

    /** Hibernate validates its entities against the tables, so the tables come first. */
    @Bean
    static BeanFactoryPostProcessor entityManagerFactoryWaitsForMigrations() {
        return (beanFactory) -> {
            for (String name : beanFactory.getBeanNamesForType(EntityManagerFactory.class, true, false)) {
                BeanDefinition definition = beanFactory.getBeanDefinition(name.startsWith("&") ? name.substring(1) : name);
                definition.setDependsOn(StringUtils.addStringToArray(definition.getDependsOn(), BEAN));
            }
        };
    }
}
