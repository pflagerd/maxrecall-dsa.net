    // Minimal JSON value type, parser, and serializer for the C++ judge harness.
// This is intentionally NOT a general-purpose JSON library: it supports exactly
// the shapes the harness needs (null, bool, integer, string, array, object with
// string keys) so submissions compile fast with no external dependency.
// Note: this file is spliced directly into each generated harness (not
// #included), so no include-guard pragma is needed.
#include <string>
#include <vector>
#include <utility>
#include <stdexcept>
#include <sstream>
#include <cctype>
#include <cstdio>

class JsonValue {
public:
    enum class Type { Null, Bool, Int, String, Array, Object };

    JsonValue() : type_(Type::Null) {}
    JsonValue(bool b) : type_(Type::Bool), bool_(b) {}
    JsonValue(long long i) : type_(Type::Int), int_(i) {}
    JsonValue(int i) : type_(Type::Int), int_(i) {}
    JsonValue(const std::string& s) : type_(Type::String), str_(s) {}
    JsonValue(const char* s) : type_(Type::String), str_(s) {}

    static JsonValue array() { JsonValue v; v.type_ = Type::Array; return v; }
    static JsonValue object() { JsonValue v; v.type_ = Type::Object; return v; }

    Type type() const { return type_; }
    bool isNull() const { return type_ == Type::Null; }
    size_t size() const { return arr_.size(); }

    void push_back(const JsonValue& v) { arr_.push_back(v); }
    const JsonValue& operator[](size_t i) const { return arr_.at(i); }

    JsonValue& operator[](const std::string& key) {
        for (auto& p : obj_) if (p.first == key) return p.second;
        obj_.emplace_back(key, JsonValue());
        return obj_.back().second;
    }
    const JsonValue& at(const std::string& key) const {
        for (auto& p : obj_) if (p.first == key) return p.second;
        throw std::runtime_error("missing key: " + key);
    }

    bool asBool() const { if (type_ != Type::Bool) throw std::runtime_error("not a bool"); return bool_; }
    long long asInt() const { if (type_ != Type::Int) throw std::runtime_error("not an int"); return int_; }
    std::string asString() const { if (type_ != Type::String) throw std::runtime_error("not a string"); return str_; }
    std::vector<int> asIntVector() const {
        if (type_ != Type::Array) throw std::runtime_error("not an array");
        std::vector<int> out;
        out.reserve(arr_.size());
        for (const auto& v : arr_) out.push_back(static_cast<int>(v.asInt()));
        return out;
    }

    std::string dump() const {
        std::ostringstream os;
        dumpTo(os);
        return os.str();
    }

private:
    void dumpTo(std::ostringstream& os) const {
        switch (type_) {
            case Type::Null: os << "null"; break;
            case Type::Bool: os << (bool_ ? "true" : "false"); break;
            case Type::Int: os << int_; break;
            case Type::String: dumpString(os, str_); break;
            case Type::Array: {
                os << '[';
                for (size_t i = 0; i < arr_.size(); ++i) {
                    if (i) os << ',';
                    arr_[i].dumpTo(os);
                }
                os << ']';
                break;
            }
            case Type::Object: {
                os << '{';
                for (size_t i = 0; i < obj_.size(); ++i) {
                    if (i) os << ',';
                    dumpString(os, obj_[i].first);
                    os << ':';
                    obj_[i].second.dumpTo(os);
                }
                os << '}';
                break;
            }
        }
    }

    static void dumpString(std::ostringstream& os, const std::string& s) {
        os << '"';
        for (unsigned char c : s) {
            switch (c) {
                case '"': os << "\\\""; break;
                case '\\': os << "\\\\"; break;
                case '\n': os << "\\n"; break;
                case '\t': os << "\\t"; break;
                case '\r': os << "\\r"; break;
                default:
                    if (c < 0x20) {
                        char buf[8];
                        std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                        os << buf;
                    } else {
                        os << static_cast<char>(c);
                    }
            }
        }
        os << '"';
    }

    Type type_;
    bool bool_ = false;
    long long int_ = 0;
    std::string str_;
    std::vector<JsonValue> arr_;
    std::vector<std::pair<std::string, JsonValue>> obj_;

    friend class JsonParser;
};

class JsonParser {
public:
    static JsonValue parse(const std::string& text) {
        JsonParser p(text);
        return p.parseValue();
    }

private:
    explicit JsonParser(const std::string& text) : s_(text), pos_(0) {}

    void skipWhitespace() {
        while (pos_ < s_.size() && std::isspace(static_cast<unsigned char>(s_[pos_]))) ++pos_;
    }

    char peek() {
        skipWhitespace();
        if (pos_ >= s_.size()) throw std::runtime_error("unexpected end of JSON");
        return s_[pos_];
    }

    JsonValue parseValue() {
        char c = peek();
        if (c == '[') return parseArray();
        if (c == '{') return parseObject();
        if (c == '"') return JsonValue(parseString());
        if (c == 't' || c == 'f') return parseBool();
        if (c == 'n') { expectLiteral("null"); return JsonValue(); }
        return parseNumber();
    }

    JsonValue parseArray() {
        expect('[');
        JsonValue v = JsonValue::array();
        if (peek() == ']') { ++pos_; return v; }
        while (true) {
            v.push_back(parseValue());
            skipWhitespace();
            char c = s_[pos_];
            if (c == ',') { ++pos_; continue; }
            if (c == ']') { ++pos_; break; }
            throw std::runtime_error("malformed array");
        }
        return v;
    }

    JsonValue parseObject() {
        expect('{');
        JsonValue v = JsonValue::object();
        if (peek() == '}') { ++pos_; return v; }
        while (true) {
            skipWhitespace();
            std::string key = parseString();
            skipWhitespace();
            expect(':');
            v[key] = parseValue();
            skipWhitespace();
            char c = s_[pos_];
            if (c == ',') { ++pos_; continue; }
            if (c == '}') { ++pos_; break; }
            throw std::runtime_error("malformed object");
        }
        return v;
    }

    std::string parseString() {
        expect('"');
        std::string out;
        while (true) {
            if (pos_ >= s_.size()) throw std::runtime_error("unterminated string");
            char c = s_[pos_++];
            if (c == '"') break;
            if (c == '\\') {
                char e = s_[pos_++];
                switch (e) {
                    case '"': out += '"'; break;
                    case '\\': out += '\\'; break;
                    case '/': out += '/'; break;
                    case 'n': out += '\n'; break;
                    case 't': out += '\t'; break;
                    case 'r': out += '\r'; break;
                    case 'b': out += '\b'; break;
                    case 'f': out += '\f'; break;
                    case 'u': {
                        // Minimal \uXXXX handling: only the ASCII range this
                        // judge's own test-case text ever needs.
                        std::string hex = s_.substr(pos_, 4);
                        pos_ += 4;
                        int code = std::stoi(hex, nullptr, 16);
                        out += static_cast<char>(code);
                        break;
                    }
                    default: out += e;
                }
            } else {
                out += c;
            }
        }
        return out;
    }

    JsonValue parseBool() {
        if (s_.compare(pos_, 4, "true") == 0) { pos_ += 4; return JsonValue(true); }
        expectLiteral("false");
        return JsonValue(false);
    }

    JsonValue parseNumber() {
        size_t start = pos_;
        if (s_[pos_] == '-') ++pos_;
        while (pos_ < s_.size() && std::isdigit(static_cast<unsigned char>(s_[pos_]))) ++pos_;
        long long value = std::stoll(s_.substr(start, pos_ - start));
        return JsonValue(value);
    }

    void expect(char c) {
        skipWhitespace();
        if (pos_ >= s_.size() || s_[pos_] != c) throw std::runtime_error(std::string("expected '") + c + "'");
        ++pos_;
    }

    void expectLiteral(const std::string& lit) {
        if (s_.compare(pos_, lit.size(), lit) != 0) throw std::runtime_error("expected literal " + lit);
        pos_ += lit.size();
    }

    const std::string& s_;
    size_t pos_;
};

inline JsonValue parseJson(const std::string& text) { return JsonParser::parse(text); }

// Typed extraction helpers, named by the type they produce so generated
// harness code can pick the right one per parameter.
inline int extractInt(const JsonValue& v) { return static_cast<int>(v.asInt()); }
inline bool extractBool(const JsonValue& v) { return v.asBool(); }
inline std::string extractString(const JsonValue& v) { return v.asString(); }
inline std::vector<int> extractIntVector(const JsonValue& v) { return v.asIntVector(); }

// Typed serialization, overloaded so generated harness code can call
// buildJson(result) without knowing the return type ahead of time.
inline JsonValue buildJson(int v) { return JsonValue(static_cast<long long>(v)); }
inline JsonValue buildJson(bool v) { return JsonValue(v); }
inline JsonValue buildJson(const std::string& v) { return JsonValue(v); }
inline JsonValue buildJson(const std::vector<int>& v) {
    JsonValue arr = JsonValue::array();
    for (int x : v) arr.push_back(JsonValue(static_cast<long long>(x)));
    return arr;
}
