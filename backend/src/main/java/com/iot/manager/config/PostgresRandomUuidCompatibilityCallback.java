package com.iot.manager.config;

import org.flywaydb.core.api.callback.BaseCallback;
import org.flywaydb.core.api.callback.Context;
import org.flywaydb.core.api.callback.Event;

import java.sql.SQLException;

/**
 * Keeps the original H2-compatible migration history intact while providing
 * PostgreSQL with the random_uuid() compatibility function that V2 expects.
 */
public final class PostgresRandomUuidCompatibilityCallback extends BaseCallback {

    private static final String CREATE_RANDOM_UUID_FUNCTION = """
            CREATE OR REPLACE FUNCTION public.random_uuid()
            RETURNS uuid
            LANGUAGE SQL
            VOLATILE
            AS 'SELECT gen_random_uuid()'
            """;

    @Override
    public boolean supports(Event event, Context context) {
        if (event != Event.BEFORE_MIGRATE) {
            return false;
        }

        // Flyway first asks callbacks with a null context in order to decide
        // whether it needs to open an event connection. The database product
        // can only be checked during the subsequent, connected invocation.
        return context == null || isPostgreSql(context);
    }

    @Override
    public boolean canHandleInTransaction(Event event, Context context) {
        return true;
    }

    @Override
    public void handle(Event event, Context context) {
        try (var statement = context.getConnection().createStatement()) {
            statement.execute(CREATE_RANDOM_UUID_FUNCTION);
        } catch (SQLException exception) {
            throw new IllegalStateException("Unable to create the PostgreSQL random_uuid() compatibility function", exception);
        }
    }

    private boolean isPostgreSql(Context context) {
        try {
            return "PostgreSQL".equalsIgnoreCase(context.getConnection().getMetaData().getDatabaseProductName());
        } catch (SQLException exception) {
            throw new IllegalStateException("Unable to identify the Flyway database product", exception);
        }
    }
}
