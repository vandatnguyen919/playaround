package app.keylab.builds.query;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import app.keylab.shared.paging.Cursor;
import app.keylab.shared.paging.PageQuery;
import app.keylab.shared.paging.PageResult;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * BLD-01 (US-08): a member's builds, public and private, newest change first
 * (or newest created first), paged by cursor. Deleted builds never show.
 * Also the one build a save or an edit answers with, and BLD-03's one build
 * as a given viewer may see it.
 */
@Component
public class MyBuilds {

    /** How the list is sorted, as {@code sort} names it. */
    public enum Sort {
        UPDATED("-updatedAt", "updated_at"), CREATED("-createdAt", "created_at");

        private final String wire;
        private final String column;

        Sort(String wire, String column) {
            this.wire = wire;
            this.column = column;
        }

        public static Optional<Sort> from(String value) {
            for (Sort sort : values()) {
                if (sort.wire.equals(value)) {
                    return Optional.of(sort);
                }
            }
            return Optional.empty();
        }
    }

    /** A page_token from another sort, or one this API did not issue. */
    public static final class BadPageToken extends RuntimeException {

        BadPageToken() {
            super("page_token is not a token from a previous page of this list");
        }
    }

    private static final String COLUMNS = """
            SELECT b.id, b.name, b.visibility, b.version, b.created_at, b.updated_at, v.id AS version_id,
              v.layout, v.switch_slug, v.switch_variant, v.keycap_set, v.keycap_profile, v.keycap_material,
              v.case_material, v.case_color_hex, v.plate, v.mount, v.desk_pad
            FROM builds.builds b JOIN builds.build_versions v ON v.id = b.current_version_id
            """;

    private final JdbcClient jdbc;

    MyBuilds(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * @param visibility "public", "private", or null for both
     * @throws BadPageToken for a token from another sort or not from this list
     */
    @Transactional(readOnly = true)
    public PageResult<BuildRow> list(UUID owner, String visibility, Sort sort, PageQuery page) {
        StringBuilder sql = new StringBuilder(COLUMNS)
            .append(" WHERE b.owner_id = :owner AND b.deleted_at IS NULL");
        Map<String, Object> params = new HashMap<>();
        params.put("owner", owner);
        if (visibility != null) {
            sql.append(" AND b.visibility = :visibility");
            params.put("visibility", visibility);
        }
        String column = "b." + sort.column;
        if (!page.isFirstPage()) {
            Cursor cursor = page.cursor();
            if (!sort.wire.equals(cursor.value(0))) {
                throw new BadPageToken();
            }
            try {
                params.put("afterTime", Timestamp.from(Instant.parse(cursor.value(1))));
                params.put("afterId", UUID.fromString(cursor.value(2)));
            }
            catch (DateTimeParseException | IllegalArgumentException ex) {
                throw new BadPageToken();
            }
            sql.append(" AND (").append(column).append(", b.id) < (:afterTime, :afterId)");
        }
        sql.append(" ORDER BY ").append(column).append(" DESC, b.id DESC LIMIT :limit");
        params.put("limit", page.limit());
        List<Base> rows = jdbc.sql(sql.toString()).params(params).query(MyBuilds::base).list();
        return PageResult.of(withMods(rows), page, (row) -> Cursor.of(sort.wire,
                sort == Sort.UPDATED ? row.updatedAt() : row.createdAt(), row.id()));
    }

    /** One of the owner's builds that is not deleted. */
    @Transactional(readOnly = true)
    public Optional<BuildRow> get(UUID owner, UUID id) {
        List<Base> rows = jdbc.sql(COLUMNS + " WHERE b.id = ? AND b.owner_id = ? AND b.deleted_at IS NULL")
            .params(id, owner)
            .query(MyBuilds::base)
            .list();
        return withMods(rows).stream().findFirst();
    }

    /** BLD-03: one build and whether the viewer owns it. */
    public record Shared(BuildRow row, boolean own) {
    }

    /**
     * BLD-03 (US-12; US-09 adds the shared page): a public build for anyone,
     * a private one for its owner only, a deleted one for nobody.
     *
     * @param viewer the signed-in caller, or null for a guest
     */
    @Transactional(readOnly = true)
    public Optional<Shared> shared(UUID viewer, UUID id) {
        List<UUID> owners = new ArrayList<>();
        List<Base> rows = jdbc.sql(COLUMNS.replace("SELECT b.id,", "SELECT b.owner_id, b.id,")
                + " WHERE b.id = :id AND b.deleted_at IS NULL AND (b.visibility = 'public' OR b.owner_id = :viewer)")
            .param("id", id)
            .param("viewer", viewer)
            .query((rs, n) -> {
                owners.add(rs.getObject("owner_id", UUID.class));
                return base(rs, n);
            })
            .list();
        return withMods(rows).stream().findFirst().map((row) -> new Shared(row, owners.get(0).equals(viewer)));
    }

    /** A row before its mods are read. */
    private record Base(BuildRow row, UUID versionId) {
    }

    private static Base base(ResultSet rs, int rowNum) throws SQLException {
        return new Base(new BuildRow(rs.getObject("id", UUID.class), rs.getString("name"),
                rs.getString("visibility"), rs.getLong("version"), rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant(), rs.getString("layout"), rs.getString("switch_slug"),
                rs.getString("switch_variant"), List.of(), rs.getString("keycap_set"), rs.getString("keycap_profile"),
                rs.getString("keycap_material"), rs.getString("case_material"), rs.getString("case_color_hex"),
                rs.getString("plate"), rs.getString("mount"), rs.getString("desk_pad")),
                rs.getObject("version_id", UUID.class));
    }

    /** One query for the mods of every row on the page. */
    private List<BuildRow> withMods(List<Base> rows) {
        if (rows.isEmpty()) {
            return List.of();
        }
        Map<UUID, List<BuildRow.Mod>> mods = new HashMap<>();
        jdbc.sql("""
                SELECT version_id, mod_slug, level FROM builds.build_version_mods
                WHERE version_id IN (:ids) ORDER BY version_id, position
                """)
            .param("ids", rows.stream().map(Base::versionId).toList())
            .query((rs, n) -> {
                mods.computeIfAbsent(rs.getObject("version_id", UUID.class), (k) -> new ArrayList<>())
                    .add(new BuildRow.Mod(rs.getString("mod_slug"), rs.getString("level")));
                return null;
            })
            .list();
        return rows.stream().map((base) -> {
            BuildRow r = base.row();
            return new BuildRow(r.id(), r.name(), r.visibility(), r.version(), r.createdAt(), r.updatedAt(),
                    r.layout(), r.switchSlug(), r.variant(), List.copyOf(mods.getOrDefault(base.versionId(), List.of())),
                    r.keycapSet(), r.keycapProfile(), r.keycapMaterial(), r.caseMaterial(), r.caseColor(), r.plate(),
                    r.mount(), r.deskPad());
        }).toList();
    }
}
