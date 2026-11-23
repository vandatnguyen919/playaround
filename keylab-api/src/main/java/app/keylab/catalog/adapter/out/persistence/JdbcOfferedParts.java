package app.keylab.catalog.adapter.out.persistence;

import java.util.Collection;
import java.util.HashSet;
import java.util.Optional;
import java.util.Set;

import app.keylab.catalog.domain.OfferedParts;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * {@link OfferedParts} in the catalog tables: the same rows the public
 * endpoints list (CAT-01, CAT-05, CAT-07, CAT-08).
 */
@Repository
class JdbcOfferedParts implements OfferedParts {

    private final JdbcClient jdbc;

    JdbcOfferedParts(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public boolean switchOffered(String slug) {
        return exists("SELECT EXISTS (SELECT 1 FROM catalog.switches WHERE slug = ? AND status = 'published')", slug);
    }

    @Override
    public Set<String> liveMods(Collection<String> slugs) {
        if (slugs.isEmpty()) {
            return Set.of();
        }
        return new HashSet<>(jdbc.sql("SELECT slug FROM catalog.mods WHERE live AND slug IN (:slugs)")
            .param("slugs", slugs)
            .query(String.class)
            .list());
    }

    @Override
    public Optional<KeycapLook> keycapSet(String slug) {
        return jdbc.sql("SELECT profile, material FROM catalog.keycap_sets WHERE slug = ? AND status = 'published'")
            .param(slug)
            .query((rs, n) -> new KeycapLook(rs.getString("profile"), rs.getString("material")))
            .optional();
    }

    @Override
    public boolean caseMaterialOffered(String id) {
        return exists("SELECT EXISTS (SELECT 1 FROM catalog.case_materials WHERE id = ? AND is_active)", id);
    }

    @Override
    public boolean plateOffered(String id) {
        return exists("SELECT EXISTS (SELECT 1 FROM catalog.plates WHERE id = ? AND is_active)", id);
    }

    @Override
    public boolean mountOffered(String id) {
        return exists("SELECT EXISTS (SELECT 1 FROM catalog.mounts WHERE id = ? AND is_active)", id);
    }

    private boolean exists(String sql, String key) {
        return jdbc.sql(sql).param(key).query(Boolean.class).single();
    }
}
