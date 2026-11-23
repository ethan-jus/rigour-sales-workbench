import Foundation
import Security

public final class RigourSessionKeychain {
    // A queued logout clears any session write submitted before it.
    private static let queue = DispatchQueue(label: "com.rigour.workbench.session-keychain")

    private static func item(_ scope: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.rigour.workbench.session",
            kSecAttrAccount as String: scope
        ]
    }

    public static func read(_ scope: String, _ completion: @escaping (Bool, String?) -> Void) {
        queue.async {
            var query = item(scope)
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            var result: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            let value = (result as? Data).flatMap { String(data: $0, encoding: .utf8) }
            let success = status == errSecItemNotFound || (status == errSecSuccess && value != nil)
            DispatchQueue.main.async { completion(success, value) }
        }
    }

    public static func write(_ scope: String, _ value: String, _ completion: @escaping (Bool) -> Void) {
        queue.async {
            var query = item(scope)
            let data = Data(value.utf8)
            let update = [kSecValueData as String: data]
            var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
            if status == errSecItemNotFound {
                query[kSecValueData as String] = data
                query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                status = SecItemAdd(query as CFDictionary, nil)
            }
            let success = status == errSecSuccess
            DispatchQueue.main.async { completion(success) }
        }
    }

    public static func clear(_ scope: String, _ completion: @escaping (Bool) -> Void) {
        queue.async {
            let status = SecItemDelete(item(scope) as CFDictionary)
            let success = status == errSecSuccess || status == errSecItemNotFound
            DispatchQueue.main.async { completion(success) }
        }
    }
}
