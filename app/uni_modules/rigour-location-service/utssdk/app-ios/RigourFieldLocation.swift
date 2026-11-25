import CoreLocation
import Foundation

public final class RigourFieldLocation: NSObject, CLLocationManagerDelegate {
    public static let shared = RigourFieldLocation()
    private var manager: CLLocationManager?
    private var sample: ((NSNumber, NSNumber, NSNumber, NSNumber) -> Void)?
    private var ready: (() -> Void)?
    private var failure: ((String) -> Void)?
    private var since = Date.distantFuture

    public func start(_ point: @escaping (NSNumber, NSNumber, NSNumber, NSNumber) -> Void,
                      _ started: @escaping () -> Void, _ failed: @escaping (String) -> Void) {
        DispatchQueue.main.async {
            self.stopOnMain()
            let manager = CLLocationManager()
            self.manager = manager
            self.since = Date()
            self.sample = point
            self.ready = started
            self.failure = failed
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyBest
            manager.distanceFilter = kCLDistanceFilterNone
            manager.allowsBackgroundLocationUpdates = true
            manager.showsBackgroundLocationIndicator = true
            manager.pausesLocationUpdatesAutomatically = false
            if CLLocationManager.authorizationStatus() == .notDetermined {
                manager.requestWhenInUseAuthorization()
            } else {
                self.updateAuthorization(manager, CLLocationManager.authorizationStatus())
            }
        }
    }

    public func stop() { DispatchQueue.main.async { self.stopOnMain() } }

    private func stopOnMain() {
        manager?.delegate = nil
        manager?.stopUpdatingLocation()
        manager = nil
        sample = nil
        ready = nil
        failure = nil
    }

    private func updateAuthorization(_ manager: CLLocationManager, _ status: CLAuthorizationStatus) {
        guard manager === self.manager else { return }
        switch status {
        case .authorizedAlways, .authorizedWhenInUse:
            if let started = ready {
                ready = nil
                manager.startUpdatingLocation()
                started()
            }
        case .restricted, .denied:
            let failed = failure
            stopOnMain()
            failed?("系统未授权外勤定位")
        default: break
        }
    }

    public func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
        updateAuthorization(manager, status)
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard manager === self.manager else { return }
        for fix in locations where fix.timestamp >= since && fix.horizontalAccuracy > 0 {
            sample?(NSNumber(value: fix.coordinate.longitude), NSNumber(value: fix.coordinate.latitude),
                    NSNumber(value: fix.horizontalAccuracy), NSNumber(value: fix.timestamp.timeIntervalSince1970 * 1000))
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard manager === self.manager, (error as? CLError)?.code == .denied else { return }
        updateAuthorization(manager, .denied)
    }
}
