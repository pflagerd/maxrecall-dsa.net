// Declarations for the minimal JSON value type, parser, and serializer used
// by the C++ judge harness. This header is intentionally declarations-only —
// the implementation lives in judge_json.cpp, compiled once into
// judge_json.o ahead of time (see judge/runner.js) and linked into each
// submission, rather than recompiled from source on every single Run/Submit.
//
// This is intentionally NOT a general-purpose JSON library: it supports
// exactly the shapes the harness needs (null, bool, integer, string, array,
// object with string keys). This file is spliced directly into each
// generated harness (not #included), so no include-guard pragma is needed.
#include <string>
#include <vector>
#include <utility>
#include <iosfwd>

class JsonValue {
public:
    enum class Type { Null, Bool, Int, String, Array, Object };

    JsonValue();
    JsonValue(bool b);
    JsonValue(long long i);
    JsonValue(int i);
    JsonValue(const std::string& s);
    JsonValue(const char* s);

    static JsonValue array();
    static JsonValue object();

    Type type() const;
    bool isNull() const;
    size_t size() const;

    void push_back(const JsonValue& v);
    const JsonValue& operator[](size_t i) const;

    JsonValue& operator[](const std::string& key);
    const JsonValue& at(const std::string& key) const;

    bool asBool() const;
    long long asInt() const;
    std::string asString() const;
    std::vector<int> asIntVector() const;

    std::string dump() const;

private:
    void dumpTo(std::ostringstream& os) const;
    static void dumpString(std::ostringstream& os, const std::string& s);

    Type type_;
    bool bool_ = false;
    long long int_ = 0;
    std::string str_;
    std::vector<JsonValue> arr_;
    std::vector<std::pair<std::string, JsonValue>> obj_;

    friend class JsonParser;
};

JsonValue parseJson(const std::string& text);

// Typed extraction helpers, named by the type they produce so generated
// harness code can pick the right one per parameter.
int extractInt(const JsonValue& v);
bool extractBool(const JsonValue& v);
std::string extractString(const JsonValue& v);
std::vector<int> extractIntVector(const JsonValue& v);

// Typed serialization, overloaded so generated harness code can call
// buildJson(result) without knowing the return type ahead of time.
JsonValue buildJson(int v);
JsonValue buildJson(bool v);
JsonValue buildJson(const std::string& v);
JsonValue buildJson(const std::vector<int>& v);
