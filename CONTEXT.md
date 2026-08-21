# PL/SQL Navigation

This context describes the PL/SQL declarations and implementations between which the extension provides semantic navigation.

## Language

**Package specification**:
The public declaration of an Oracle package and its public subprograms.
_Avoid_: Package spec file

**Package body**:
The implementation part of an Oracle package, including implementations of public subprograms and private members.

**Object type specification**:
The declaration of a schema-level Oracle object type, including the signatures of its constructors and methods.
_Avoid_: Type spec file, package type

**Object type body**:
The implementation part of a schema-level Oracle object type's constructors and methods.

**Spec/body counterpart**:
The corresponding declaration or implementation belonging to the same named PL/SQL program unit or member.
_Avoid_: Matching file

**Program unit**:
A schema-level PL/SQL unit that can have separate declaration and implementation parts, such as a package or object type.

**Member declaration**:
A procedure, function, constructor, or method signature declared in a program unit's specification.

**Member implementation**:
The body that implements a member declaration in the corresponding package or object type body.

**Overload**:
One of multiple members that share a name and are distinguished by their parameter signatures.

**Public member**:
A member declared in a package or object type specification and implemented by its spec/body counterpart.

**Private member**:
A member declared only inside a package body and therefore lacking a counterpart in the package specification.

**Forward declaration**:
A declaration inside a body that introduces a private member before its later implementation.

**Repository document**:
A local source file under version control that is the authoritative representation of a database object.
_Avoid_: Offline database object

**Database document**:
A virtual document opened from a connected database for inspection or testing; it is not the authoritative development source.
_Avoid_: Remote source file
