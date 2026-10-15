-- A published version still never changes. It may only be deleted once it is
-- no longer the form's current version and no submission was ever filled in
-- against it (the designer deleting an unused form).
CREATE OR REPLACE FUNCTION form_definition_versions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND NOT EXISTS (SELECT 1 FROM form_submissions WHERE version_id = OLD.id)
    AND NOT EXISTS (SELECT 1 FROM form_definitions WHERE published_version_id = OLD.id)
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'published form definition versions cannot be modified'
    USING ERRCODE = '23514', CONSTRAINT = 'form_definition_versions_immutable';
END;
$$;
