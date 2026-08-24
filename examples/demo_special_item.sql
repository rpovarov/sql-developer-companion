CREATE OR REPLACE TYPE demo_item_list_type FORCE AS TABLE OF demo_item_type;
/

CREATE OR REPLACE TYPE demo_special_item_type FORCE UNDER demo_item_type (
    discount_percent NUMBER,

    OVERRIDING MEMBER FUNCTION score(
        p_value IN NUMBER
    ) RETURN NUMBER,

    MEMBER FUNCTION discounted_label
        RETURN VARCHAR2
);
/

CREATE OR REPLACE TYPE BODY demo_special_item_type AS

    OVERRIDING MEMBER FUNCTION score(
        p_value IN NUMBER
    ) RETURN NUMBER IS
    BEGIN
        RETURN p_value * (100 - NVL(SELF.discount_percent, 0)) / 100;
    END score;

    MEMBER FUNCTION discounted_label
        RETURN VARCHAR2 IS
    BEGIN
        -- Inherited-member navigation follows UNDER demo_item_type.
        RETURN SELF.display_name() || ' (' || SELF.discount_percent || '%)';
    END discounted_label;

END demo_special_item_type;
/

DECLARE
    l_item demo_item_type;
    l_special demo_special_item_type;
BEGIN
    -- Schema-type navigation recognizes a TREAT target.
    l_special := TREAT(l_item AS demo_special_item_type);
END;
/
