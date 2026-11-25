import CryptoKit
import Foundation

public enum RigourProtectedFieldStorage {
    private static let queue = DispatchQueue(label: "com.rigour.workbench.field-storage")

    private static func file(_ scope: String, create: Bool = false) throws -> URL {
        let manager = FileManager.default
        let base = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: create)
        var directory = base.appendingPathComponent("RigourFieldwork", isDirectory: true)
        if create && !manager.fileExists(atPath: directory.path) {
            try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        if create {
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try directory.setResourceValues(values)
        }
        let name = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(name + ".json")
    }

    public static func read(_ scope: String, _ completion: @escaping (Bool, String?) -> Void) {
        queue.async {
            do {
                let data = try Data(contentsOf: file(scope))
                let value = String(data: data, encoding: .utf8)
                DispatchQueue.main.async { completion(value != nil, value) }
            } catch CocoaError.fileReadNoSuchFile, CocoaError.fileNoSuchFile {
                DispatchQueue.main.async { completion(true, nil) }
            } catch {
                DispatchQueue.main.async { completion(false, nil) }
            }
        }
    }

    public static func write(_ scope: String, _ value: String, _ completion: @escaping (Bool) -> Void) {
        queue.async {
            do {
                // A locked phone can write the offline queue after its first unlock.
                try Data(value.utf8).write(to: file(scope, create: true), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                DispatchQueue.main.async { completion(true) }
            } catch {
                DispatchQueue.main.async { completion(false) }
            }
        }
    }

    public static func clear(_ scope: String, _ completion: @escaping (Bool) -> Void) {
        queue.async {
            do {
                try FileManager.default.removeItem(at: file(scope))
                DispatchQueue.main.async { completion(true) }
            } catch CocoaError.fileReadNoSuchFile, CocoaError.fileNoSuchFile {
                DispatchQueue.main.async { completion(true) }
            } catch {
                DispatchQueue.main.async { completion(false) }
            }
        }
    }
}
