import AMapFoundationKit
import CoreLocation
import UIKit

enum RigourMapSupport {
    static func convertGPS(_ latitude: Double, _ longitude: Double) -> CLLocationCoordinate2D {
        AMapCoordinateConvert(CLLocationCoordinate2D(latitude: latitude, longitude: longitude), .GPS)
    }

    static func openPrivacy() {
        if let url = URL(string: "https://lbs.amap.com/pages/privacy/") {
            UIApplication.shared.open(url)
        }
    }
}
