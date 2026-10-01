"""One physical arclength convention for borders and candidate exports."""
import numpy as np
from numpy.polynomial import Polynomial
from scipy.integrate import quad

class StemArc:
    def __init__(self, coefficients, intervals, spacing):
        c = np.asarray(coefficients, float)
        self.x, self.y = Polynomial(c[:,0]), Polynomial(c[:,1])
        self.dx, self.dy = self.x.deriv(), self.y.deriv()
        self.lo = min(a for a,b in intervals)
        self.hi = max(b for a,b in intervals)
        self.spacing = spacing
        self.length = self.at(self.hi)
        if not self.length > 1e-10:
            raise ValueError('Degenerate stem tangent/domain')

    def speed(self, t):
        return float(np.hypot(self.dx(t), self.dy(t))*self.spacing)

    def at(self, t):
        return quad(self.speed,self.lo,float(t),epsabs=1e-9,epsrel=1e-10)[0]
